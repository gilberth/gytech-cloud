import { Divider, Flex, Progress, Stack, Text, Image, Box, Group, Avatar, TextInput, ActionIcon, Tooltip } from "@mantine/core";
import { ModalsContextProps } from "@mantine/modals/lib/context";
import moment from "moment";
import { FormattedMessage } from "react-intl";
import { translateOutsideContext } from "../../hooks/useTranslate.hook";
import { FileMetaData } from "../../types/File.type";
import { TbFile, TbFileText, TbPhoto, TbVideo, TbMusic, TbFileZip, TbExternalLink, TbCopy } from "react-icons/tb";
import { MyShare } from "../../types/share.type";
import { byteToHumanSizeString } from "../../utils/fileSize.util";
import toast from "../../utils/toast.util";

// Helper functions for file handling
const getFileIcon = (fileName: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
    return <TbPhoto size={20} color="#4CAF50" />;
  } else if (['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv'].includes(ext)) {
    return <TbVideo size={20} color="#FF5722" />;
  } else if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) {
    return <TbMusic size={20} color="#9C27B0" />;
  } else if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return <TbFileZip size={20} color="#FF9800" />;
  } else if (['txt', 'md', 'rtf'].includes(ext)) {
    return <TbFileText size={20} color="#2196F3" />;
  } else {
    return <TbFile size={20} color="#757575" />;
  }
};

const isImageFile = (fileName: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext);
};

const getFileNames = (share: MyShare) => {
  if (!share.files || share.files.length === 0) return [];
  return share.files.map((file: any) => file.name);
};

const showShareInformationsModal = (
  modals: ModalsContextProps,
  share: MyShare,
  maxShareSize: number,
) => {
  const t = translateOutsideContext();
  const link = `${window.location.origin}/s/${share.id}`;
  const fileNames = getFileNames(share);

  const formattedShareSize = byteToHumanSizeString(share.size);
  const formattedMaxShareSize = byteToHumanSizeString(maxShareSize);
  const shareSizeProgress = (share.size / maxShareSize) * 100;

  const formattedCreatedAt = moment(share.createdAt).format("LLL");
  const formattedExpiration =
    moment(share.expiration).unix() === 0
      ? "Never"
      : moment(share.expiration).format("LLL");

  return modals.openModal({
    title: t("account.shares.modal.share-informations"),

    children: (
      <Stack align="stretch" spacing="md">
        {/* File Preview Section */}
        {share.files && share.files.length > 0 && (
          <Box>
            <Text size="sm" weight={500} mb="xs">
              Vista previa
            </Text>
            <Box 
              sx={(theme) => ({
                border: `1px solid ${theme.colorScheme === 'dark' ? theme.colors.dark[4] : theme.colors.gray[3]}`,
                borderRadius: theme.radius.md,
                padding: theme.spacing.md,
                backgroundColor: theme.colorScheme === 'dark' ? theme.colors.dark[7] : theme.colors.gray[0],
              })}
            >
              {share.files.length === 1 ? (
                // Single file preview
                <Stack align="center" spacing="sm">
                  {isImageFile(share.files[0].name) ? (
                    <Image
                      src={`${window.location.origin}/api/shares/${share.id}/files/${share.files[0].id}/${encodeURIComponent(share.files[0].name)}`}
                      alt={share.files[0].name}
                      width={200}
                      height={200}
                      fit="contain"
                      withPlaceholder
                      placeholder={getFileIcon(share.files[0].name)}
                    />
                  ) : (
                    <Box p="xl">
                      {getFileIcon(share.files[0].name)}
                    </Box>
                  )}
                  <Text size="sm" weight={500} align="center">
                    {share.files[0].name}
                  </Text>
                </Stack>
              ) : (
                // Multiple files preview
                <Stack spacing="xs">
                  <Text size="sm" weight={500} align="center" mb="sm">
                    {share.files.length} archivos
                  </Text>
                  <Group position="center" spacing="sm">
                    {share.files.slice(0, 4).map((file: any, index: number) => (
                      <Stack key={file.id} align="center" spacing={4}>
                        {isImageFile(file.name) ? (
                          <Avatar
                            src={`${window.location.origin}/api/shares/${share.id}/files/${file.id}/${encodeURIComponent(file.name)}`}
                            size={60}
                            radius="sm"
                            alt={file.name}
                          >
                            {getFileIcon(file.name)}
                          </Avatar>
                        ) : (
                          <Box p="sm">
                            {getFileIcon(file.name)}
                          </Box>
                        )}
                        <Text size="xs" align="center" sx={{ maxWidth: 80 }} truncate>
                          {file.name}
                        </Text>
                      </Stack>
                    ))}
                    {share.files.length > 4 && (
                      <Text size="sm" color="dimmed">
                        +{share.files.length - 4} más
                      </Text>
                    )}
                  </Group>
                </Stack>
              )}
            </Box>
          </Box>
        )}
        
        {/* File Names Section */}
        <Text size="sm">
          <b>
            Archivo(s):{" "}
          </b>
          {fileNames.length > 0 ? (
            fileNames.length === 1 ? (
              fileNames[0]
            ) : (
              `${fileNames[0]} y ${fileNames.length - 1} archivo(s) más`
            )
          ) : (
            share.name || "Sin nombre"
          )}
        </Text>
        
        <Text size="sm">
          <b>
            <FormattedMessage id="account.shares.table.id" />:{" "}
          </b>
          {share.id}
        </Text>

        <Text size="sm">
          <b>
            <FormattedMessage id="account.shares.table.description" />:{" "}
          </b>
          {share.description || "-"}
        </Text>

        <Text size="sm">
          <b>
            <FormattedMessage id="account.shares.table.createdAt" />:{" "}
          </b>
          {formattedCreatedAt}
        </Text>

        <Text size="sm">
          <b>
            <FormattedMessage id="account.shares.table.expiresAt" />:{" "}
          </b>
          {formattedExpiration}
        </Text>
        <Divider />
        
        {/* All links without labels */}
        <Stack spacing="sm">
          {/* Main share link */}
          <TextInput
            readOnly
            variant="filled"
            value={link}
            onClick={() => {
              if (window.isSecureContext) {
                navigator.clipboard.writeText(link);
                toast.success("Enlace copiado");
              }
            }}
            rightSectionWidth={62}
            rightSection={
              <>
                <Tooltip label="Abrir enlace" position="top" offset={-2} openDelay={200}>
                  <ActionIcon component="a" href={link} target="_blank">
                    <TbExternalLink size={16} />
                  </ActionIcon>
                </Tooltip>
                {window.isSecureContext && (
                  <Tooltip label="Copiar enlace" position="top" offset={-2} openDelay={200}>
                    <ActionIcon onClick={() => {
                      navigator.clipboard.writeText(link);
                      toast.success("Enlace copiado");
                    }}>
                      <TbCopy size={16} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </>
            }
          />
          
          {/* Direct download URLs for files */}
          {share.files && share.files.length > 0 && share.files.map((file: any, index: number) => {
            const directDownloadUrl = `${window.location.origin}/api/shares/${share.id}/files/${file.id}/${encodeURIComponent(file.name)}`;
            return (
              <TextInput
                key={file.id}
                readOnly
                variant="filled"
                value={directDownloadUrl}
                onClick={() => {
                  if (window.isSecureContext) {
                    navigator.clipboard.writeText(directDownloadUrl);
                    toast.success("Enlace copiado");
                  }
                }}
                rightSectionWidth={62}
                rightSection={
                  <>
                    <Tooltip label="Abrir enlace" position="top" offset={-2} openDelay={200}>
                      <ActionIcon component="a" href={directDownloadUrl} target="_blank">
                        <TbExternalLink size={16} />
                      </ActionIcon>
                    </Tooltip>
                    {window.isSecureContext && (
                      <Tooltip label="Copiar enlace" position="top" offset={-2} openDelay={200}>
                        <ActionIcon onClick={() => {
                          navigator.clipboard.writeText(directDownloadUrl);
                          toast.success("Enlace copiado");
                        }}>
                          <TbCopy size={16} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </>
                }
              />
            );
          })}
        </Stack>
        
        <Divider />
        <Text size="sm">
          <b>
            <FormattedMessage id="account.shares.table.size" />:{" "}
          </b>
          {formattedShareSize} / {formattedMaxShareSize} (
          {shareSizeProgress.toFixed(1)}%)
        </Text>

        <Flex align="center" justify="center">
          {share.size / maxShareSize < 0.1 && (
            <Text size="xs" style={{ marginRight: "4px" }}>
              {formattedShareSize}
            </Text>
          )}
          <Progress
            value={shareSizeProgress}
            label={share.size / maxShareSize >= 0.1 ? formattedShareSize : ""}
            style={{ width: share.size / maxShareSize < 0.1 ? "70%" : "80%" }}
            size="xl"
            radius="xl"
          />
          <Text size="xs" style={{ marginLeft: "4px" }}>
            {formattedMaxShareSize}
          </Text>
        </Flex>
        
        {/* Detailed file list for multiple files */}
        {share.files && share.files.length > 1 && (
          <Box>
            <Text size="sm" weight={500} mb="xs">
              Lista de archivos:
            </Text>
            <Stack spacing={4}>
              {share.files.map((file: any, index: number) => (
                <Group key={file.id} spacing="xs">
                  {getFileIcon(file.name)}
                  <Text size="xs">
                    {index + 1}. {file.name}
                  </Text>
                </Group>
              ))}
            </Stack>
          </Box>
        )}
      </Stack>
    ),
  });
};

export default showShareInformationsModal;
