import { Button, Group } from "@mantine/core";
import { useModals } from "@mantine/modals";
import { cleanNotifications } from "@mantine/notifications";
import { AxiosError } from "axios";
import pLimit from "p-limit";
import { useEffect, useRef, useState } from "react";
import { FormattedMessage } from "react-intl";
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

  const { user } = useUser();
  const config = useConfig();
  const [files, setFiles] = useState<FileUpload[]>([]);
  const [isUploading, setisUploading] = useState(false);

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
          expiration: "1-days", // Default 1 day expiration
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

  return (
    <>
      <Meta title={t("upload.title")} />
      {!autoUploadFiles && (
        <Group position="right" mb={20}>
          <Button
            loading={isUploading}
            disabled={files.length <= 0}
            onClick={() => showCreateUploadModalCallback(files)}
          >
            <FormattedMessage id="common.button.share" />
          </Button>
        </Group>
      )}
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
