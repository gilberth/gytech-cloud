import { Box, Group, Text, Title, Stack, Card, Image, Badge, Grid, Avatar, Paper, Divider } from "@mantine/core";
import { useModals } from "@mantine/modals";
import { GetServerSidePropsContext } from "next";
import { useEffect, useState } from "react";
import { FormattedMessage } from "react-intl";
import { TbFile, TbFileText, TbPhoto, TbVideo, TbMusic, TbFileZip, TbDownload, TbShare, TbClock } from "react-icons/tb";
import moment from "moment";
import Meta from "../../../components/Meta";
import DownloadAllButton from "../../../components/share/DownloadAllButton";
import FileList from "../../../components/share/FileList";
import showEnterPasswordModal from "../../../components/share/showEnterPasswordModal";
import showErrorModal from "../../../components/share/showErrorModal";
import showFilePreviewModal from "../../../components/share/modals/showFilePreviewModal";
import useTranslate from "../../../hooks/useTranslate.hook";
import shareService from "../../../services/share.service";
import { Share as ShareType } from "../../../types/share.type";
import toast from "../../../utils/toast.util";
import { byteToHumanSizeString } from "../../../utils/fileSize.util";

// Helper functions for file handling
const getFileIcon = (fileName: string, size: number = 20) => {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
    return <TbPhoto size={size} color="#4CAF50" />;
  } else if (['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv'].includes(ext)) {
    return <TbVideo size={size} color="#FF5722" />;
  } else if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) {
    return <TbMusic size={size} color="#9C27B0" />;
  } else if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return <TbFileZip size={size} color="#FF9800" />;
  } else if (['txt', 'md', 'rtf', 'doc', 'docx', 'pdf'].includes(ext)) {
    return <TbFileText size={size} color="#2196F3" />;
  } else {
    return <TbFile size={size} color="#757575" />;
  }
};

const isImageFile = (fileName: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext);
};

const getFileTypeLabel = (fileName: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
    return { label: 'Imagen', color: 'green' };
  } else if (['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv'].includes(ext)) {
    return { label: 'Video', color: 'red' };
  } else if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) {
    return { label: 'Audio', color: 'violet' };
  } else if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return { label: 'Archivo', color: 'orange' };
  } else if (['txt', 'md', 'rtf', 'doc', 'docx', 'pdf'].includes(ext)) {
    return { label: 'Documento', color: 'blue' };
  } else {
    return { label: 'Archivo', color: 'gray' };
  }
};

export function getServerSideProps(context: GetServerSidePropsContext) {
  return {
    props: { shareId: context.params!.shareId },
  };
}

const Share = ({ shareId }: { shareId: string }) => {
  const modals = useModals();
  const [share, setShare] = useState<ShareType>();
  const t = useTranslate();

  const getShareToken = async (password?: string) => {
    await shareService
      .getShareToken(shareId, password)
      .then(() => {
        modals.closeAll();
        getFiles();
      })
      .catch((e) => {
        const { error } = e.response.data;
        if (error == "share_max_views_exceeded") {
          showErrorModal(
            modals,
            t("share.error.visitor-limit-exceeded.title"),
            t("share.error.visitor-limit-exceeded.description"),
            "go-home",
          );
        } else if (error == "share_password_required") {
          showEnterPasswordModal(modals, getShareToken);
        } else {
          toast.axiosError(e);
        }
      });
  };

  const getFiles = async () => {
    shareService
      .get(shareId)
      .then((share) => {
        setShare(share);
      })
      .catch((e) => {
        const { error } = e.response.data;
        if (e.response.status == 404) {
          if (error == "share_removed") {
            showErrorModal(
              modals,
              t("share.error.removed.title"),
              e.response.data.message,
              "go-home",
            );
          } else {
            showErrorModal(
              modals,
              t("share.error.not-found.title"),
              t("share.error.not-found.description"),
              "go-home",
            );
          }
        } else if (e.response.status == 403 && error == "private_share") {
          showErrorModal(
            modals,
            t("share.error.access-denied.title"),
            t("share.error.access-denied.description"),
          );
        } else if (error == "share_password_required") {
          showEnterPasswordModal(modals, getShareToken);
        } else if (error == "share_token_required") {
          getShareToken();
        } else {
          showErrorModal(
            modals,
            t("common.error"),
            t("common.error.unknown"),
            "go-home",
          );
        }
      });
  };

  useEffect(() => {
    getFiles();
  }, []);

  const totalSize = share?.files?.reduce(
    (total: number, file: { size: string }) => total + parseInt(file.size),
    0,
  ) || 0;

  const imageFiles = share?.files?.filter(file => isImageFile(file.name)) || [];
  const nonImageFiles = share?.files?.filter(file => !isImageFile(file.name)) || [];

  return (
    <>
      <Meta
        title={t("share.title", { shareId: share?.name || shareId })}
        description={t("share.description")}
      />

      {/* Header mejorado */}
      <Paper p="xl" mb="lg" withBorder>
        <Stack spacing="md">
          <Group position="apart" align="flex-start">
            <Box style={{ flex: 1 }}>
              <Group spacing="sm" mb="xs">
                <TbShare size={24} color="#495057" />
                <Title order={2}>{share?.name || `Share ${shareId}`}</Title>
              </Group>
              
              {share?.description && (
                <Text size="md" color="dimmed" mb="sm">
                  {share.description}
                </Text>
              )}
              
              <Group spacing="lg">
                <Group spacing="xs">
                  <TbDownload size={16} color="#495057" />
                  <Text size="sm" weight={500}>
                    {share?.files?.length || 0} archivo(s)
                  </Text>
                </Group>
                
                <Group spacing="xs">
                  <Text size="sm" weight={500}>
                    {byteToHumanSizeString(totalSize)}
                  </Text>
                </Group>
                
                {share?.expiration && moment(share.expiration).unix() !== 0 && (
                  <Group spacing="xs">
                    <TbClock size={16} color="#495057" />
                    <Text size="sm" color="dimmed">
                      Expira {moment(share.expiration).fromNow()}
                    </Text>
                  </Group>
                )}
              </Group>
            </Box>

            {share?.files && share.files.length > 1 && (
              <DownloadAllButton shareId={shareId} />
            )}
          </Group>
        </Stack>
      </Paper>

      {/* Vista previa de imágenes */}
      {imageFiles.length > 0 && (
        <Card mb="lg" p="md" withBorder>
          <Title order={4} mb="md">
            <Group spacing="xs">
              <TbPhoto size={20} />
              <Text>Vista previa de imágenes</Text>
            </Group>
          </Title>
          
          <Grid>
            {imageFiles.slice(0, 6).map((file: any) => (
              <Grid.Col span={4} key={file.id}>
                <Card p="xs" withBorder>
                  <Image
                    src={`/api/shares/${shareId}/files/${file.id}/${encodeURIComponent(file.name)}`}
                    alt={file.name}
                    height={120}
                    fit="cover"
                    withPlaceholder
                    placeholder={getFileIcon(file.name, 40)}
                    sx={{ cursor: 'pointer' }}
                    onClick={async () => {
                      await shareService.downloadFile(shareId, file.id);
                    }}
                  />
                  <Text size="xs" truncate mt="xs" align="center">
                    {file.name}
                  </Text>
                  <Text size="xs" color="dimmed" align="center">
                    {byteToHumanSizeString(parseInt(file.size))}
                  </Text>
                </Card>
              </Grid.Col>
            ))}
          </Grid>
          
          {imageFiles.length > 6 && (
            <Text size="sm" color="dimmed" mt="sm" align="center">
              +{imageFiles.length - 6} imágenes más
            </Text>
          )}
        </Card>
      )}

      {/* Lista de archivos mejorada */}
      <Card withBorder>
        <Card.Section p="md" withBorder>
          <Title order={4}>
            <Group spacing="xs">
              <TbFile size={20} />
              <Text>Todos los archivos</Text>
            </Group>
          </Title>
        </Card.Section>
        
        <Card.Section p="md">
          <Stack spacing="sm">
            {share?.files?.map((file: any) => (
              <Paper key={file.id} p="md" withBorder sx={{ cursor: 'pointer' }}>
                <Group position="apart">
                  <Group spacing="md">
                    <Avatar size="md" radius="sm">
                      {getFileIcon(file.name, 24)}
                    </Avatar>
                    
                    <Box>
                      <Text weight={500} size="sm">{file.name}</Text>
                      <Group spacing="xs">
                        <Badge 
                          size="xs" 
                          variant="light" 
                          color={getFileTypeLabel(file.name).color}
                        >
                          {getFileTypeLabel(file.name).label}
                        </Badge>
                        <Text size="xs" color="dimmed">
                          {byteToHumanSizeString(parseInt(file.size))}
                        </Text>
                      </Group>
                    </Box>
                  </Group>
                  
                  <Group spacing="xs">
                    {shareService.doesFileSupportPreview(file.name) && (
                      <Badge 
                        size="xs" 
                        variant="light" 
                        color="blue"
                        sx={{ cursor: 'pointer' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          showFilePreviewModal(shareId, file, modals);
                        }}
                      >
                        Vista previa
                      </Badge>
                    )}
                    
                    <Badge 
                      size="xs" 
                      color="green" 
                      sx={{ cursor: 'pointer' }}
                      onClick={async (e) => {
                        e.stopPropagation();
                        await shareService.downloadFile(shareId, file.id);
                      }}
                    >
                      Descargar
                    </Badge>
                  </Group>
                </Group>
              </Paper>
            )) || []}
          </Stack>
        </Card.Section>
      </Card>
    </>
  );
};

export default Share;
