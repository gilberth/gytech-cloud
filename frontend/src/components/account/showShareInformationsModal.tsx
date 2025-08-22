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
const truncateFileName = (fileName: string, maxLength: number = 40) => {
  if (fileName.length <= maxLength) return fileName;
  
  const extension = fileName.split('.').pop() || '';
  const nameWithoutExt = fileName.slice(0, fileName.lastIndexOf('.'));
  const extensionLength = extension.length + 1; // +1 for the dot
  
  if (extensionLength >= maxLength - 3) {
    // If extension is too long, just truncate the whole string
    return fileName.slice(0, maxLength - 3) + '...';
  }
  
  const maxNameLength = maxLength - extensionLength - 3; // -3 for '...'
  return nameWithoutExt.slice(0, maxNameLength) + '...' + '.' + extension;
};

const truncateUrl = (url: string, maxLength: number = 60) => {
  if (url.length <= maxLength) return url;
  
  // Extract the important parts
  const urlParts = url.split('/');
  const protocol = urlParts[0] + '//' + urlParts[2]; // http://localhost:3000
  const fileName = urlParts[urlParts.length - 1]; // The encoded filename
  
  // If the filename itself is very long, truncate it
  const decodedFileName = decodeURIComponent(fileName);
  const truncatedFileName = truncateFileName(decodedFileName, 20);
  const encodedTruncatedFileName = encodeURIComponent(truncatedFileName);
  
  // Create a shortened version
  const baseUrl = protocol + '/api/shares/[ID]/files/[FILE]';
  const displayUrl = baseUrl.replace('[FILE]', encodedTruncatedFileName);
  
  if (displayUrl.length <= maxLength) return displayUrl;
  
  // If still too long, truncate more aggressively
  return url.slice(0, maxLength - 3) + '...';
};
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
                  <Tooltip label={share.files[0].name} position="bottom" multiline maw={400}>
                    <Text size="sm" weight={500} align="center" sx={{ cursor: 'help', textAlign: 'center', width: '100%' }}>
                      {truncateFileName(share.files[0].name, 45)}
                    </Text>
                  </Tooltip>
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
                        <Tooltip label={file.name} position="bottom" openDelay={300}>
                          <Text size="xs" align="center" sx={{ maxWidth: 80, cursor: 'help' }} truncate>
                            {file.name}
                          </Text>
                        </Tooltip>
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
        <Box>
          <Text size="sm">
            <b>Archivo(s): </b>
            {fileNames.length > 0 ? (
              fileNames.length === 1 ? (
                <Tooltip label={fileNames[0]} position="top" multiline maw={400} disabled={fileNames[0].length <= 50}>
                  <Text component="span" sx={{ cursor: fileNames[0].length > 50 ? 'help' : 'default' }}>
                    {truncateFileName(fileNames[0], 50)}
                  </Text>
                </Tooltip>
              ) : (
                <Tooltip 
                  label={fileNames.join(', ')} 
                  position="top" 
                  multiline 
                  maw={400}
                >
                  <Text component="span" sx={{ cursor: 'help' }}>
                    {truncateFileName(fileNames[0], 30)} y {fileNames.length - 1} archivo(s) más
                  </Text>
                </Tooltip>
              )
            ) : (
              share.name || "Sin nombre"
            )}
          </Text>
        </Box>
        
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
            styles={{
              input: {
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }
            }}
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
            const displayUrl = truncateUrl(directDownloadUrl, 55);
            return (
              <Box key={file.id}>
                <Tooltip label={`Enlace directo: ${file.name}`} position="top" multiline maw={400}>
                  <TextInput
                    readOnly
                    variant="filled"
                    value={displayUrl}
                    onClick={() => {
                      if (window.isSecureContext) {
                        navigator.clipboard.writeText(directDownloadUrl);
                        toast.success("Enlace copiado");
                      }
                    }}
                    rightSectionWidth={62}
                    styles={{
                      input: {
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }
                    }}
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
                </Tooltip>
              </Box>
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
                  <Tooltip label={file.name} position="top" openDelay={300}>
                    <Text size="xs" sx={{ cursor: 'help' }}>
                      {index + 1}. {truncateFileName(file.name, 40)}
                    </Text>
                  </Tooltip>
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
