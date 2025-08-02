import { Button, Group, Stack, Text, Paper, useMantineTheme } from "@mantine/core";
import { useModals } from "@mantine/modals";
import { cleanNotifications } from "@mantine/notifications";
import { AxiosError } from "axios";
import pLimit from "p-limit";
import { useEffect, useRef, useState, useCallback } from "react";
import { FormattedMessage } from "react-intl";
import { TbClipboard, TbShare } from "react-icons/tb";
import Meta from "../../components/Meta";
import Dropzone from "../../components/upload/Dropzone";
import FileList from "../../components/upload/FileList";
import showCompletedUploadModal from "../../components/upload/modals/showCompletedUploadModal";
import showCreateUploadModal from "../../components/upload/modals/showCreateUploadModal";
import useConfig from "../../hooks/config.hook";
import useConfirmLeave from "../../hooks/confirm-leave.hook";
import useTranslate from "../../hooks/useTranslate.hook";
import useUser from "../../hooks/user.hook";
import shareService from "../../services/share.service";
import { FileUpload } from "../../types/File.type";
import { CreateShare, Share } from "../../types/share.type";
import toast from "../../utils/toast.util";
import { useRouter } from "next/router";

const promiseLimit = pLimit(3);
let errorToastShown = false;
let createdShare: Share;

const generateShareId = (length: number = 16) => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const randomArray = new Uint8Array(length >= 3 ? length : 3);
  crypto.getRandomValues(randomArray);
  randomArray.forEach((number) => {
    result += chars[number % chars.length];
  });
  return result;
};

const generateAvailableLink = async (
  shareIdLength: number,
  times: number = 10,
): Promise<string> => {
  if (times <= 0) {
    throw new Error("Could not generate available link");
  }
  const _link = generateShareId(shareIdLength);
  if (!(await shareService.isShareIdAvailable(_link))) {
    return await generateAvailableLink(shareIdLength, times - 1);
  } else {
    return _link;
  }
};

const Upload = ({
  maxShareSize,
  isReverseShare = false,
  simplified,
}: {
  maxShareSize?: number;
  isReverseShare: boolean;
  simplified: boolean;
}) => {
  const modals = useModals();
  const router = useRouter();
  const t = useTranslate();
  const theme = useMantineTheme();

  const { user } = useUser();
  const config = useConfig();
  const [files, setFiles] = useState<FileUpload[]>([]);
  const [isUploading, setisUploading] = useState(false);
  const [pasteAreaFocused, setPasteAreaFocused] = useState(false);

  useConfirmLeave({
    message: t("upload.notify.confirm-leave"),
    enabled: isUploading,
  });

  const chunkSize = useRef(parseInt(config.get("share.chunkSize")));

  maxShareSize ??= parseInt(config.get("share.maxSize"));
  const autoOpenCreateUploadModal = config.get("share.autoOpenShareModal");
  // Safe access to new config option with fallback
  let autoUploadFiles = false;
  try {
    autoUploadFiles = config.get("share.autoUploadFiles") === true;
  } catch (e) {
    // Config option doesn't exist yet, use default
    autoUploadFiles = true; // Default to automatic upload
  }

  const uploadFiles = async (share: CreateShare, files: FileUpload[]) => {
    setisUploading(true);

    try {
      const isReverseShare = router.pathname != "/upload";
      createdShare = await shareService.create(share, isReverseShare);
    } catch (e) {
      toast.axiosError(e);
      setisUploading(false);
      return;
    }

    const fileUploadPromises = files.map(async (file, fileIndex) =>
      // Limit the number of concurrent uploads to 3
      promiseLimit(async () => {
        let fileId;

        const setFileProgress = (progress: number) => {
          setFiles((files) =>
            files.map((file, callbackIndex) => {
              if (fileIndex == callbackIndex) {
                file.uploadingProgress = progress;
              }
              return file;
            }),
          );
        };

        setFileProgress(1);

        let chunks = Math.ceil(file.size / chunkSize.current);

        // If the file is 0 bytes, we still need to upload 1 chunk
        if (chunks == 0) chunks++;

        for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
          const from = chunkIndex * chunkSize.current;
          const to = from + chunkSize.current;
          const blob = file.slice(from, to);
          try {
            await shareService
              .uploadFile(
                createdShare.id,
                blob,
                {
                  id: fileId,
                  name: file.name,
                },
                chunkIndex,
                chunks,
              )
              .then((response) => {
                fileId = response.id;
              });

            setFileProgress(((chunkIndex + 1) / chunks) * 100);
          } catch (e) {
            if (
              e instanceof AxiosError &&
              e.response?.data.error == "unexpected_chunk_index"
            ) {
              // Retry with the expected chunk index
              chunkIndex = e.response!.data!.expectedChunkIndex - 1;
              continue;
            } else {
              setFileProgress(-1);
              // Retry after 5 seconds
              await new Promise((resolve) => setTimeout(resolve, 5000));
              chunkIndex = -1;

              continue;
            }
          }
        }
      }),
    );

    Promise.all(fileUploadPromises);
  };

  const showCreateUploadModalCallback = (files: FileUpload[]) => {
    showCreateUploadModal(
      modals,
      {
        isUserSignedIn: user ? true : false,
        isReverseShare,
        allowUnauthenticatedShares: config.get(
          "share.allowUnauthenticatedShares",
        ),
        enableEmailRecepients: config.get("email.enableShareEmailRecipients"),
        maxExpiration: config.get("share.maxExpiration"),
        shareIdLength: config.get("share.shareIdLength"),
        simplified,
      },
      files,
      uploadFiles,
    );
  };

  const handleDropzoneFilesChanged = async (files: FileUpload[]) => {
    if (autoUploadFiles) {
      // Fully automatic upload - no modal, no button, just upload immediately
      setFiles((oldArr) => [...oldArr, ...files]);
      
      try {
        // Create default share and upload automatically
        const defaultShare: CreateShare = {
          id: await generateAvailableLink(config.get("share.shareIdLength")),
          name: undefined,
          expiration: "never", // Default never expires
          recipients: [],
          description: undefined,
          security: {
            password: undefined,
            maxViews: undefined,
          },
        };
        
        // Start upload immediately with new files
        uploadFiles(defaultShare, files);
      } catch (error) {
        toast.error(t("upload.notify.generic-error"));
      }
    } else if (autoOpenCreateUploadModal) {
      setFiles(files);
      showCreateUploadModalCallback(files);
    } else {
      // Normal behavior - show files and require "Compartir" button click
      setFiles((oldArr) => [...oldArr, ...files]);
    }
  };

  useEffect(() => {
    // Check if there are any files that failed to upload
    const fileErrorCount = files.filter(
      (file) => file.uploadingProgress == -1,
    ).length;

    if (fileErrorCount > 0) {
      if (!errorToastShown) {
        toast.error(
          t("upload.notify.count-failed", { count: fileErrorCount }),
          {
            withCloseButton: false,
            autoClose: false,
          },
        );
      }
      errorToastShown = true;
    } else {
      cleanNotifications();
      errorToastShown = false;
    }

    // Complete share
    if (
      files.length > 0 &&
      files.every((file) => file.uploadingProgress >= 100) &&
      fileErrorCount == 0
    ) {
      shareService
        .completeShare(createdShare.id)
        .then((share) => {
          setisUploading(false);
          showCompletedUploadModal(modals, share);
          setFiles([]);
        })
        .catch(() => toast.error(t("upload.notify.generic-error")));
    }
  }, [files]);

  // Handle clipboard paste
  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    e.preventDefault();
    
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter(item => item.type.startsWith('image/'));
    
    if (imageItems.length === 0) {
      toast.error(t("upload.notify.no-image-in-clipboard") || "No se encontraron imágenes en el portapapeles");
      return;
    }

    const newFiles: FileUpload[] = [];
    
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (file) {
        // Generate a filename based on timestamp and type
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const extension = file.type.split('/')[1] || 'png';
        const filename = `pasted-image-${timestamp}.${extension}`;
        
        // Create a new File object with the generated name
        const renamedFile = new File([file], filename, { type: file.type }) as FileUpload;
        renamedFile.uploadingProgress = 0;
        newFiles.push(renamedFile);
      }
    }
    
    if (newFiles.length > 0) {
      toast.success(t("upload.notify.image-pasted") || `${newFiles.length} imagen(es) pegada(s) desde el portapapeles`);
      handleDropzoneFilesChanged(newFiles);
    }
  }, [config, t, handleDropzoneFilesChanged]);

  // Add paste event listener
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      // Only handle paste if the paste area is focused or no input is focused
      const activeElement = document.activeElement;
      const isInputFocused = activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        (activeElement as HTMLElement).contentEditable === 'true'
      );
      
      if (!isInputFocused || pasteAreaFocused) {
        handlePaste(e);
      }
    };

    document.addEventListener('paste', handleGlobalPaste);
    return () => document.removeEventListener('paste', handleGlobalPaste);
  }, [handlePaste, pasteAreaFocused]);

  const handleQuickShare = async () => {
    if (files.length === 0) return;
    
    try {
      const defaultShare: CreateShare = {
        id: await generateAvailableLink(config.get("share.shareIdLength")),
        name: files.length === 1 ? files[0].name : `${files.length} archivos`,
        expiration: "7-days", // Quick share defaults to 7 days
        recipients: [],
        description: undefined,
        security: {
          password: undefined,
          maxViews: undefined,
        },
      };
      
      uploadFiles(defaultShare, files);
    } catch (error) {
      toast.error(t("upload.notify.generic-error"));
    }
  };

  return (
    <>
      <Meta title={t("upload.title")} />
      {!autoUploadFiles && (
        <Group position="right" mb={20} spacing="sm">
          <Button
            variant="light"
            loading={isUploading}
            disabled={files.length <= 0}
            onClick={handleQuickShare}
            leftIcon={<TbShare size={16} />}
          >
            Compartir Rápido
          </Button>
          <Button
            loading={isUploading}
            disabled={files.length <= 0}
            onClick={() => showCreateUploadModalCallback(files)}
          >
            <FormattedMessage id="common.button.share" />
          </Button>
        </Group>
      )}
      
      {/* Clipboard paste area */}
      <Stack spacing="md" mb="md">
        <Paper
          p="md"
          withBorder
          sx={(theme) => ({
            backgroundColor: theme.colorScheme === 'dark' 
              ? (pasteAreaFocused ? theme.colors.dark[6] : theme.colors.dark[7])
              : (pasteAreaFocused ? theme.colors.gray[0] : theme.colors.gray[1]),
            borderColor: theme.colorScheme === 'dark'
              ? (pasteAreaFocused ? theme.colors.dark[4] : theme.colors.dark[5])
              : (pasteAreaFocused ? theme.colors.gray[4] : theme.colors.gray[3]),
            borderStyle: 'dashed',
            borderWidth: 1,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            '&:hover': {
              backgroundColor: theme.colorScheme === 'dark' 
                ? theme.colors.dark[6] 
                : theme.colors.gray[0],
              borderColor: theme.colorScheme === 'dark'
                ? theme.colors.dark[4]
                : theme.colors.gray[4],
            }
          })}
          tabIndex={0}
          onFocus={() => setPasteAreaFocused(true)}
          onBlur={() => setPasteAreaFocused(false)}
          onClick={() => {
            // Focus the element to enable paste detection
            const element = document.activeElement as HTMLElement;
            if (element) {
              element.focus();
            }
          }}
        >
          <Group spacing="sm" position="center">
            <TbClipboard 
              size={24} 
              color={
                theme.colorScheme === 'dark'
                  ? (pasteAreaFocused ? theme.colors.dark[3] : theme.colors.dark[2])
                  : (pasteAreaFocused ? theme.colors.gray[6] : theme.colors.gray[5])
              }
            />
            <Stack spacing={4} align="center">
              <Text
                size="sm"
                weight={500}
                color={pasteAreaFocused ? undefined : 'dimmed'}
              >
                Pegar imágenes desde el portapapeles
              </Text>
              <Text size="xs" color="dimmed">
                Haz clic aquí y presiona Ctrl+V (Cmd+V en Mac) para pegar imágenes
              </Text>
            </Stack>
          </Group>
        </Paper>
      </Stack>
      
      <Dropzone
        title={
          !autoOpenCreateUploadModal && files.length > 0
            ? t("share.edit.append-upload")
            : undefined
        }
        maxShareSize={maxShareSize}
        onFilesChanged={handleDropzoneFilesChanged}
        isUploading={isUploading}
      />
      {files.length > 0 && (
        <FileList<FileUpload> files={files} setFiles={setFiles} />
      )}
    </>
  );
};
export default Upload;
