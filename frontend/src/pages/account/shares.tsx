import {
  ActionIcon,
  Avatar,
  Box,
  Button,
  Center,
  Group,
  Image,
  Space,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { useModals } from "@mantine/modals";
import moment from "moment";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TbEdit, TbInfoCircle, TbLink, TbLock, TbTrash, TbFile, TbFileText, TbPhoto, TbVideo, TbMusic, TbFileZip } from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import Meta from "../../components/Meta";
import showShareInformationsModal from "../../components/account/showShareInformationsModal";
import showShareLinkModal from "../../components/account/showShareLinkModal";
import CenterLoader from "../../components/core/CenterLoader";
import useConfig from "../../hooks/config.hook";
import useTranslate from "../../hooks/useTranslate.hook";
import shareService from "../../services/share.service";
import { MyShare } from "../../types/share.type";
import toast from "../../utils/toast.util";

const MyShares = () => {
  const modals = useModals();
  const clipboard = useClipboard();
  const config = useConfig();
  const t = useTranslate();

  const [shares, setShares] = useState<MyShare[]>();

  // Function to get file icon based on file type
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

  // Function to check if file is an image
  const isImageFile = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext);
  };

  // Function to get the display name for a share (file name or share name)
  const getShareDisplayName = (share: MyShare) => {
    if (share.files && share.files.length > 0) {
      const firstFile = share.files[0];
      if (share.files.length === 1) {
        return firstFile.name;
      } else {
        return `${firstFile.name} +${share.files.length - 1} más`;
      }
    }
    return share.name || share.id;
  };

  // Function to render file thumbnail only
  const renderFileThumbnail = (files: any[], shareId: string) => {
    if (!files || files.length === 0) return '-';
    
    const firstFile = files[0];
    const isImage = isImageFile(firstFile.name);
    
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {isImage ? (
          <Avatar
            src={`${window.location.origin}/api/shares/${shareId}/files/${firstFile.id}/${encodeURIComponent(firstFile.name)}`}
            size={40}
            radius="sm"
            alt={firstFile.name}
          >
            {getFileIcon(firstFile.name)}
          </Avatar>
        ) : (
          getFileIcon(firstFile.name)
        )}
      </div>
    );
  };

  useEffect(() => {
    shareService.getMyShares().then((shares) => setShares(shares));
  }, []);

  if (!shares) return <CenterLoader />;

  return (
    <>
      <Meta title={t("account.shares.title")} />
      <Title mb={30} order={3}>
        <FormattedMessage id="account.shares.title" />
      </Title>
      {shares.length == 0 ? (
        <Center style={{ height: "70vh" }}>
          <Stack align="center" spacing={10}>
            <Title order={3}>
              <FormattedMessage id="account.shares.title.empty" />
            </Title>
            <Text>
              <FormattedMessage id="account.shares.description.empty" />
            </Text>
            <Space h={5} />
            <Button component={Link} href="/upload" variant="light">
              <FormattedMessage id="account.shares.button.create" />
            </Button>
          </Stack>
        </Center>
      ) : (
        <Box sx={{ display: "block", overflowX: "auto" }}>
          <Table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Miniatura</th>
                <th>
                  <FormattedMessage id="account.shares.table.visitors" />
                </th>
                <th>
                  <FormattedMessage id="account.shares.table.expiresAt" />
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shares.map((share) => (
                <tr key={share.id}>
                  <td>
                    <Group spacing="xs">
                      <Text size="sm" truncate style={{ maxWidth: '300px' }}>
                        {getShareDisplayName(share)}
                      </Text>
                      {share.security.passwordProtected && (
                        <TbLock
                          color="orange"
                          title={t("account.shares.table.password-protected")}
                        />
                      )}
                    </Group>
                  </td>
                  <td>{renderFileThumbnail(share.files, share.id)}</td>
                  <td>
                    {share.security.maxViews ? (
                      <FormattedMessage
                        id="account.shares.table.visitor-count"
                        values={{
                          count: share.views,
                          max: share.security.maxViews,
                        }}
                      />
                    ) : (
                      share.views
                    )}
                  </td>
                  <td>
                    {moment(share.expiration).unix() === 0 ? (
                      <FormattedMessage id="account.shares.table.expiry-never" />
                    ) : (
                      moment(share.expiration).format("LLL")
                    )}
                  </td>
                  <td>
                    <Group position="right">
                      <Link href={`/share/${share.id}/edit`}>
                        <ActionIcon color="orange" variant="light" size={25}>
                          <TbEdit />
                        </ActionIcon>
                      </Link>
                      <ActionIcon
                        color="blue"
                        variant="light"
                        size={25}
                        onClick={() => {
                          showShareInformationsModal(
                            modals,
                            share,
                            parseInt(config.get("share.maxSize")),
                          );
                        }}
                      >
                        <TbInfoCircle />
                      </ActionIcon>
                      <ActionIcon
                        color="victoria"
                        variant="light"
                        size={25}
                        onClick={() => {
                          if (window.isSecureContext) {
                            clipboard.copy(
                              `${window.location.origin}/s/${share.id}`,
                            );
                            toast.success(t("common.notify.copied-link"));
                          } else {
                            showShareLinkModal(modals, share.id);
                          }
                        }}
                      >
                        <TbLink />
                      </ActionIcon>
                      <ActionIcon
                        color="red"
                        variant="light"
                        size={25}
                        onClick={() => {
                          modals.openConfirmModal({
                            title: t("account.shares.modal.delete.title", {
                              share: share.id,
                            }),
                            children: (
                              <Text size="sm">
                                <FormattedMessage id="account.shares.modal.delete.description" />
                              </Text>
                            ),
                            confirmProps: {
                              color: "red",
                            },
                            labels: {
                              confirm: t("common.button.delete"),
                              cancel: t("common.button.cancel"),
                            },
                            onConfirm: () => {
                              shareService.remove(share.id);
                              setShares(
                                shares.filter((item) => item.id !== share.id),
                              );
                            },
                          });
                        }}
                      >
                        <TbTrash />
                      </ActionIcon>
                    </Group>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Box>
      )}
    </>
  );
};

export default MyShares;
