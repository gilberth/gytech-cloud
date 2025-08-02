import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Checkbox,
  Divider,
  Group,
  Image,
  Paper,
  Space,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { useClipboard, useMediaQuery } from "@mantine/hooks";
import { useModals } from "@mantine/modals";
import { useDebouncedValue } from "@mantine/hooks";
import moment from "moment";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TbEdit, TbInfoCircle, TbLink, TbLock, TbTrash, TbFile, TbFileText, TbPhoto, TbVideo, TbMusic, TbFileZip, TbSearch, TbFileSpreadsheet, TbPresentation } from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import Meta from "../../components/Meta";
import showShareInformationsModal from "../../components/account/showShareInformationsModal";
import showShareEditModal from "../../components/account/showShareEditModal";
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
  const [filteredShares, setFilteredShares] = useState<MyShare[]>();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch] = useDebouncedValue(searchQuery, 300);
  const [selectedShares, setSelectedShares] = useState<Set<string>>(new Set());
  const isMobile = useMediaQuery('(max-width: 768px)');

  // Function to get file icon based on file type
  const getFileIcon = (fileName: string, size: number = 20) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    
    // Images
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
      return <TbPhoto size={size} color="#4CAF50" />;
    }
    // Videos  
    else if (['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv'].includes(ext)) {
      return <TbVideo size={size} color="#FF5722" />;
    }
    // Audio
    else if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) {
      return <TbMusic size={size} color="#9C27B0" />;
    }
    // Archives
    else if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
      return <TbFileZip size={size} color="#FF9800" />;
    }
    // PDF
    else if (ext === 'pdf') {
      return <TbFileText size={size} color="#DC143C" />;
    }
    // Word Documents  
    else if (['doc', 'docx'].includes(ext)) {
      return <TbFileText size={size} color="#2B579A" />;
    }
    // Spreadsheets
    else if (['xls', 'xlsx'].includes(ext)) {
      return <TbFileSpreadsheet size={size} color="#217346" />;
    }
    // Presentations
    else if (['ppt', 'pptx'].includes(ext)) {
      return <TbPresentation size={size} color="#D24726" />;
    }
    // Text files
    else if (['txt', 'md', 'rtf'].includes(ext)) {
      return <TbFileText size={size} color="#2196F3" />;
    }
    // Generic files
    else {
      return <TbFile size={size} color="#757575" />;
    }
  };

  // Function to check if file is an image
  const isImageFile = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext);
  };

  // Function to get share status
  const getShareStatus = (share: MyShare) => {
    const now = moment();
    const expiration = moment(share.expiration);
    
    if (expiration.unix() === 0) {
      return { status: 'active', label: t('account.shares.table.expiry-never'), color: 'blue' };
    }
    
    if (expiration.isBefore(now)) {
      return { status: 'expired', label: t('account.shares.status.expired'), color: 'red' };
    }
    
    if (expiration.diff(now, 'days') <= 7) {
      return { status: 'expiring', label: t('account.shares.status.expiring'), color: 'yellow' };
    }
    
    if (share.security.maxViews && share.views >= share.security.maxViews) {
      return { status: 'view-limit', label: t('account.shares.status.view-limit'), color: 'orange' };
    }
    
    return { status: 'active', label: t('account.shares.status.active'), color: 'green' };
  };

  // Function to get the display name for a share (file name or share name)
  const getShareDisplayName = (share: MyShare) => {
    if (share.files && share.files.length > 0) {
      const firstFile = share.files[0];
      if (share.files.length === 1) {
        return firstFile.name;
      } else {
        return `${firstFile.name} +${share.files.length - 1} ${t('account.shares.table.more-files')}`;
      }
    }
    return share.name || share.id;
  };

  // Function to get file extension
  const getFileExtension = (fileName: string) => {
    return fileName.split('.').pop()?.toLowerCase() || '';
  };

  // Function to get file type description
  const getFileTypeDescription = (fileName: string) => {
    const ext = getFileExtension(fileName);
    
    const descriptions: { [key: string]: string } = {
      'pdf': 'Documento PDF',
      'doc': 'Documento de Word',
      'docx': 'Documento de Word',
      'xls': 'Hoja de cálculo de Excel',
      'xlsx': 'Hoja de cálculo de Excel', 
      'ppt': 'Presentación de PowerPoint',
      'pptx': 'Presentación de PowerPoint',
      'txt': 'Archivo de texto',
      'md': 'Archivo Markdown',
      'jpg': 'Imagen JPEG',
      'jpeg': 'Imagen JPEG',
      'png': 'Imagen PNG',
      'gif': 'Imagen GIF',
      'mp4': 'Video MP4',
      'avi': 'Video AVI',
      'mp3': 'Audio MP3',
      'wav': 'Audio WAV',
      'zip': 'Archivo ZIP',
      'rar': 'Archivo RAR'
    };
    
    return descriptions[ext] || `Archivo ${ext.toUpperCase()}`;
  };

  // Function to render file thumbnail with extension badge
  const renderFileThumbnail = (files: any[], shareId: string) => {
    if (!files || files.length === 0) return '-';
    
    const firstFile = files[0];
    const isImage = isImageFile(firstFile.name);
    const extension = getFileExtension(firstFile.name);
    const fileSize = parseInt(firstFile.size);
    const fileSizeFormatted = fileSize > 0 ? 
      `${(fileSize / 1024 / 1024).toFixed(1)} MB` : 
      'Tamaño desconocido';
    
    const thumbnailElement = (
      <Box style={{ position: 'relative', display: 'inline-block' }}>
        {isImage ? (
          <Avatar
            src={`${window.location.origin}/api/shares/${shareId}/files/${firstFile.id}/${encodeURIComponent(firstFile.name)}`}
            size={40}
            radius="sm"
            alt={firstFile.name}
          >
            {getFileIcon(firstFile.name, 24)}
          </Avatar>
        ) : (
          <Box style={{ 
            width: 40, 
            height: 40, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center' 
          }}>
            {getFileIcon(firstFile.name, 24)}
          </Box>
        )}
        
        {/* Extension badge for non-images */}
        {!isImage && extension && (
          <Badge
            size="xs"
            color="gray"
            variant="filled"
            style={{
              position: 'absolute',
              bottom: -4,
              right: -4,
              fontSize: '8px',
              minWidth: '18px',
              height: '12px',
              lineHeight: '12px',
              padding: '0 3px',
              textTransform: 'uppercase',
              fontWeight: 600
            }}
          >
            {extension}
          </Badge>
        )}
      </Box>
    );
    
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Tooltip
          label={`${getFileTypeDescription(firstFile.name)} • ${fileSizeFormatted}`}
          multiline
          width={220}
          position="top"
        >
          {thumbnailElement}
        </Tooltip>
      </div>
    );
  };

  // Mobile card component
  const renderMobileCard = (share: MyShare) => (
    <Card key={share.id} p="md" withBorder mb="sm">
      <Stack spacing="sm">
        <Group position="apart" align="flex-start">
          <Group spacing="sm" style={{ flex: 1 }}>
            <Checkbox
              checked={selectedShares.has(share.id)}
              onChange={() => handleSelectShare(share.id)}
            />
            
            <Box style={{ flex: 1 }}>
              <Group spacing="xs" mb="xs">
                <Text size="sm" weight={500} truncate style={{ maxWidth: '200px' }}>
                  {getShareDisplayName(share)}
                </Text>
                {share.security.passwordProtected && (
                  <TbLock color="orange" size={16} />
                )}
              </Group>
              
              <Group spacing="xs" mb="xs">
                <Badge 
                  size="xs" 
                  color={getShareStatus(share).color}
                  variant="light"
                >
                  {getShareStatus(share).label}
                </Badge>
                <Text size="xs" color="dimmed">
                  {share.security.maxViews ? (
                    `${share.views}/${share.security.maxViews} visitas`
                  ) : (
                    `${share.views} visitas`
                  )}
                </Text>
              </Group>
              
              <Text size="xs" color="dimmed">
                {moment(share.expiration).unix() === 0 
                  ? t('account.shares.table.expiry-never')
                  : `Expira: ${moment(share.expiration).format("DD/MM/YYYY")}`
                }
              </Text>
            </Box>
            
            <Box>
              {renderFileThumbnail(share.files, share.id)}
            </Box>
          </Group>
        </Group>
        
        <Divider />
        
        <Group position="center" spacing="xs">
          <ActionIcon
            color="orange"
            variant="light"
            size="sm"
            onClick={() => {
              showShareEditModal(
                modals,
                share,
                () => {
                  shareService.getMyShares().then((shares) => {
                    setShares(shares);
                    setFilteredShares(shares);
                  });
                }
              );
            }}
          >
            <TbEdit size={16} />
          </ActionIcon>
          
          <ActionIcon
            color="blue"
            variant="light"
            size="sm"
            onClick={() => {
              showShareInformationsModal(
                modals,
                share,
                parseInt(config.get("share.maxSize")),
              );
            }}
          >
            <TbInfoCircle size={16} />
          </ActionIcon>
          
          <ActionIcon
            color="victoria"
            variant="light"
            size="sm"
            onClick={() => {
              if (window.isSecureContext) {
                clipboard.copy(`${window.location.origin}/s/${share.id}`);
                toast.success(t("common.notify.copied-link"));
              } else {
                showShareLinkModal(modals, share.id);
              }
            }}
          >
            <TbLink size={16} />
          </ActionIcon>
          
          <ActionIcon
            color="red"
            variant="light"
            size="sm"
            onClick={() => {
              modals.openConfirmModal({
                title: t("account.shares.modal.delete.title", { share: share.id }),
                children: (
                  <Text size="sm">
                    <FormattedMessage id="account.shares.modal.delete.description" />
                  </Text>
                ),
                confirmProps: { color: "red" },
                labels: {
                  confirm: t("common.button.delete"),
                  cancel: t("common.button.cancel"),
                },
                onConfirm: () => {
                  shareService.remove(share.id);
                  const updatedShares = shares?.filter((item) => item.id !== share.id) || [];
                  setShares(updatedShares);
                  setFilteredShares(updatedShares);
                },
              });
            }}
          >
            <TbTrash size={16} />
          </ActionIcon>
        </Group>
      </Stack>
    </Card>
  );

  // Bulk selection functions
  const handleSelectAll = () => {
    if (selectedShares.size === filteredShares?.length) {
      setSelectedShares(new Set());
    } else {
      setSelectedShares(new Set(filteredShares?.map(share => share.id) || []));
    }
  };

  const handleSelectShare = (shareId: string) => {
    const newSelected = new Set(selectedShares);
    if (newSelected.has(shareId)) {
      newSelected.delete(shareId);
    } else {
      newSelected.add(shareId);
    }
    setSelectedShares(newSelected);
  };

  const handleBulkDelete = () => {
    const selectedCount = selectedShares.size;
    modals.openConfirmModal({
      title: t("account.shares.bulk.confirm-delete.title", { count: selectedCount }),
      children: (
        <Text size="sm">
          {t("account.shares.bulk.confirm-delete.description", { count: selectedCount })}
        </Text>
      ),
      confirmProps: {
        color: "red",
      },
      labels: {
        confirm: t("common.button.delete"),
        cancel: t("common.button.cancel"),
      },
      onConfirm: async () => {
        try {
          // Delete all selected shares
          await Promise.all(
            Array.from(selectedShares).map(shareId => shareService.remove(shareId))
          );
          
          // Update the state
          const updatedShares = shares?.filter(share => !selectedShares.has(share.id)) || [];
          setShares(updatedShares);
          setFilteredShares(updatedShares);
          setSelectedShares(new Set());
          
          toast.success(`${selectedCount} archivos compartidos eliminados correctamente`);
        } catch (error) {
          toast.error("Error al eliminar algunos archivos compartidos");
        }
      },
    });
  };

  // Filter shares based on search query
  useEffect(() => {
    if (!shares) return;
    
    if (!debouncedSearch.trim()) {
      setFilteredShares(shares);
      return;
    }
    
    const searchLower = debouncedSearch.toLowerCase();
    const filtered = shares.filter(share => {
      // Search in share name
      if (share.name && share.name.toLowerCase().includes(searchLower)) {
        return true;
      }
      
      // Search in display name
      if (getShareDisplayName(share).toLowerCase().includes(searchLower)) {
        return true;
      }
      
      // Search in file names
      if (share.files && share.files.some((file: any) => 
        file.name.toLowerCase().includes(searchLower)
      )) {
        return true;
      }
      
      // Search in share ID
      if (share.id.toLowerCase().includes(searchLower)) {
        return true;
      }
      
      return false;
    });
    
    setFilteredShares(filtered);
  }, [shares, debouncedSearch]);

  // Clear selection when filtered shares change
  useEffect(() => {
    setSelectedShares(new Set());
  }, [filteredShares]);

  useEffect(() => {
    shareService.getMyShares().then((shares) => {
      setShares(shares);
      setFilteredShares(shares);
    });
  }, []);

  if (!shares || !filteredShares) return <CenterLoader />;

  return (
    <>
      <Meta title={t("account.shares.title")} />
      <Title mb={30} order={3}>
        <FormattedMessage id="account.shares.title" />
      </Title>
      
      {shares.length > 0 && (
        <Stack spacing="md" mb="md">
          <TextInput
            placeholder={t('account.shares.search.placeholder')}
            icon={<TbSearch size={16} />}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
            sx={{ maxWidth: 400 }}
          />
          
          {filteredShares && filteredShares.length > 0 && (
            <Group spacing="sm">
              <Button
                variant="light"
                size="xs"
                onClick={handleSelectAll}
              >
                {selectedShares.size === filteredShares.length 
                  ? t('account.shares.bulk.deselect-all')
                  : t('account.shares.bulk.select-all')
                }
              </Button>
              
              {selectedShares.size > 0 && (
                <>
                  <Text size="sm" color="dimmed">
                    {t('account.shares.bulk.selected-count', { count: selectedShares.size })}
                  </Text>
                  <Button
                    variant="light"
                    color="red"
                    size="xs"
                    onClick={handleBulkDelete}
                  >
                    {t('account.shares.bulk.delete-selected')}
                  </Button>
                </>
              )}
            </Group>
          )}
        </Stack>
      )}
      
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
        <Box>
          {filteredShares.length === 0 ? (
            <Center style={{ height: "200px" }}>
              <Stack align="center" spacing={10}>
                <Text size="lg" color="dimmed">
                  {searchQuery ? t('account.shares.search.no-results') : 'No hay archivos compartidos'}
                </Text>
                {searchQuery && (
                  <Text size="sm" color="dimmed">
                    {t('account.shares.search.try-different')}
                  </Text>
                )}
              </Stack>
            </Center>
          ) : isMobile ? (
            <Stack spacing="sm">
              {filteredShares.map((share) => renderMobileCard(share))}
            </Stack>
          ) : (
            <Box sx={{ overflowX: "auto" }}>
              <Table>
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>
                    <Checkbox
                      checked={selectedShares.size === filteredShares.length && filteredShares.length > 0}
                      indeterminate={selectedShares.size > 0 && selectedShares.size < filteredShares.length}
                      onChange={handleSelectAll}
                    />
                  </th>
                  <th><FormattedMessage id="account.shares.table.name" /></th>
                  <th>{t('account.shares.table.thumbnail')}</th>
                  <th>{t('account.shares.table.status')}</th>
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
                {filteredShares.map((share) => (
                  <tr key={share.id}>
                    <td>
                      <Checkbox
                        checked={selectedShares.has(share.id)}
                        onChange={() => handleSelectShare(share.id)}
                      />
                    </td>
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
                      <Badge 
                        size="sm" 
                        color={getShareStatus(share).color}
                        variant="light"
                      >
                        {getShareStatus(share).label}
                      </Badge>
                    </td>
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
                        <ActionIcon
                          color="orange"
                          variant="light"
                          size={25}
                          onClick={() => {
                            showShareEditModal(
                              modals,
                              share,
                              () => {
                                // Refresh shares after edit
                                shareService.getMyShares().then((shares) => {
                                  setShares(shares);
                                  setFilteredShares(shares);
                                });
                              }
                            );
                          }}
                        >
                          <TbEdit />
                        </ActionIcon>
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
                                const updatedShares = shares.filter((item) => item.id !== share.id);
                                setShares(updatedShares);
                                setFilteredShares(updatedShares);
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
        </Box>
      )}
    </>
  );
};

export default MyShares;