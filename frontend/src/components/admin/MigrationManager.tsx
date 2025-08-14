import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Container,
  Group,
  LoadingOverlay,
  Modal,
  Progress,
  Select,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
  ActionIcon,
  Grid,
  Col,
} from "@mantine/core";
import { useInterval } from "@mantine/hooks";
import { showNotification } from "@mantine/notifications";
import { TbRefresh, TbArrowRight, TbCheck, TbX, TbClock, TbDatabase } from "react-icons/tb";
import { useEffect, useState } from "react";
import { FormattedMessage } from "react-intl";
import useTranslate from "../../hooks/useTranslate.hook";
import api from "../../services/api.service";
import { byteToHumanSizeString } from "../../utils/fileSize.util";

interface ShareCandidate {
  id: string;
  name: string;
  storageProvider: string;
  createdAt: string;
  fileCount: number;
  totalSize: number;
}

interface MigrationStatus {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  totalFiles: number;
  migratedFiles: number;
  failedFiles: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

interface StorageProvider {
  provider: string;
  displayName: string;
  enabled: boolean;
  capabilities?: {
    connected: boolean;
  };
}

const MigrationManager = () => {
  const t = useTranslate();
  
  const [shares, setShares] = useState<ShareCandidate[]>([]);
  const [providers, setProviders] = useState<StorageProvider[]>([]);
  const [migrations, setMigrations] = useState<MigrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [selectedShares, setSelectedShares] = useState<Set<string>>(new Set());
  const [migrationModalOpen, setMigrationModalOpen] = useState(false);
  const [targetProvider, setTargetProvider] = useState<string>("");
  const [startingMigration, setStartingMigration] = useState(false);
  
  const [filterProvider, setFilterProvider] = useState<string>("all");
  
  // Auto-refresh migrations every 5 seconds
  const interval = useInterval(() => {
    if (migrations.some(m => m.status === 'running' || m.status === 'pending')) {
      loadMigrations();
    }
  }, 5000);

  // Load data
  const loadData = async () => {
    try {
      setLoading(true);
      const [sharesResponse, providersResponse, migrationsResponse] = await Promise.all([
        api.get("/admin/migration/shares"),
        api.get("/admin/storage/providers"),
        api.get("/admin/migration/status/all"),
      ]);
      
      setShares(sharesResponse.data);
      setProviders(providersResponse.data.filter((p: StorageProvider) => p.enabled));
      setMigrations(migrationsResponse.data);
    } catch (error) {
      showNotification({
        title: "Error",
        message: "Failed to load migration data",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadMigrations = async () => {
    try {
      const response = await api.get("/admin/migration/status/all");
      setMigrations(response.data);
    } catch (error) {
      console.error("Failed to refresh migrations:", error);
    }
  };

  // Start migration
  const startMigration = async () => {
    if (!targetProvider || selectedShares.size === 0) {
      return;
    }

    setStartingMigration(true);
    try {
      const response = await api.post("/admin/migration/start", {
        shareIds: Array.from(selectedShares),
        targetProvider,
      });
      
      showNotification({
        title: "Migration Started",
        message: `Migration ${response.data.migrationId} has been started`,
        color: "green",
      });
      
      setMigrationModalOpen(false);
      setSelectedShares(new Set());
      setTargetProvider("");
      
      // Start polling for updates
      interval.start();
      
      await loadMigrations();
    } catch (error) {
      showNotification({
        title: "Error",
        message: "Failed to start migration",
        color: "red",
      });
    } finally {
      setStartingMigration(false);
    }
  };

  // Cancel migration
  const cancelMigration = async (migrationId: string) => {
    try {
      await api.post("/admin/migration/cancel", { migrationId });
      showNotification({
        title: "Migration Cancelled",
        message: "Migration has been cancelled",
        color: "orange",
      });
      await loadMigrations();
    } catch (error) {
      showNotification({
        title: "Error",
        message: "Failed to cancel migration",
        color: "red",
      });
    }
  };

  // Filter shares
  const filteredShares = shares.filter(share => 
    filterProvider === "all" || share.storageProvider === filterProvider
  );

  // Get provider display name
  const getProviderDisplayName = (providerType: string) => {
    const provider = providers.find(p => p.provider === providerType);
    return provider?.displayName || providerType;
  };

  // Get status badge
  const getStatusBadge = (status: string) => {
    const statusProps = {
      pending: { color: 'gray', icon: <TbClock size={12} /> },
      running: { color: 'blue', icon: <TbRefresh size={12} /> },
      completed: { color: 'green', icon: <TbCheck size={12} /> },
      failed: { color: 'red', icon: <TbX size={12} /> },
    };
    
    const props = statusProps[status as keyof typeof statusProps] || statusProps.pending;
    
    return (
      <Badge color={props.color} variant="light" leftSection={props.icon}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  // Handle share selection
  const handleShareSelection = (shareId: string) => {
    const newSelected = new Set(selectedShares);
    if (newSelected.has(shareId)) {
      newSelected.delete(shareId);
    } else {
      newSelected.add(shareId);
    }
    setSelectedShares(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedShares.size === filteredShares.length) {
      setSelectedShares(new Set());
    } else {
      setSelectedShares(new Set(filteredShares.map(s => s.id)));
    }
  };

  useEffect(() => {
    loadData();
    return interval.stop;
  }, []);

  return (
    <Container size="xl">
      <LoadingOverlay visible={loading} />
      
      <Group position="apart" mb="md">
        <Title order={2}>
          <FormattedMessage id="admin.migration.title" defaultMessage="Storage Migration" />
        </Title>
        <Group>
          <Button leftIcon={<TbRefresh />} onClick={loadData}>
            Refresh
          </Button>
          <Button 
            disabled={selectedShares.size === 0}
            onClick={() => setMigrationModalOpen(true)}
          >
            Migrate Selected ({selectedShares.size})
          </Button>
        </Group>
      </Group>

      <Grid mb="md">
        <Col span={8}>
          {/* Shares Table */}
          <Card withBorder>
            <Group position="apart" mb="md">
              <Text weight={500}>Shares</Text>
              <Select
                placeholder="Filter by provider"
                value={filterProvider}
                onChange={(value) => setFilterProvider(value || 'all')}
                data={[
                  { value: "all", label: "All Providers" },
                  ...Array.from(new Set(shares.map(s => s.storageProvider))).map(p => ({
                    value: p,
                    label: getProviderDisplayName(p),
                  })),
                ]}
              />
            </Group>
            
            <Table>
              <thead>
                <tr>
                  <th>
                    <Checkbox
                      checked={selectedShares.size === filteredShares.length && filteredShares.length > 0}
                      indeterminate={selectedShares.size > 0 && selectedShares.size < filteredShares.length}
                      onChange={handleSelectAll}
                    />
                  </th>
                  <th>Name</th>
                  <th>Provider</th>
                  <th>Files</th>
                  <th>Size</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {filteredShares.map((share) => (
                  <tr key={share.id}>
                    <td>
                      <Checkbox
                        checked={selectedShares.has(share.id)}
                        onChange={() => handleShareSelection(share.id)}
                      />
                    </td>
                    <td>
                      <Text size="sm" truncate style={{ maxWidth: 200 }}>
                        {share.name}
                      </Text>
                      <Text size="xs" color="dimmed">
                        {share.id}
                      </Text>
                    </td>
                    <td>
                      <Badge variant="light">
                        {getProviderDisplayName(share.storageProvider)}
                      </Badge>
                    </td>
                    <td>{share.fileCount}</td>
                    <td>{byteToHumanSizeString(share.totalSize)}</td>
                    <td>
                      <Text size="xs">
                        {new Date(share.createdAt).toLocaleDateString()}
                      </Text>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </Col>
        
        <Col span={4}>
          {/* Active Migrations */}
          <Card withBorder>
            <Text weight={500} mb="md">Active Migrations</Text>
            
            {migrations.length === 0 ? (
              <Text color="dimmed" size="sm" ta="center" py="md">
                No migrations found
              </Text>
            ) : (
              <Stack spacing="sm">
                {migrations.map((migration) => (
                  <Card key={migration.id} withBorder p="sm">
                    <Group position="apart" mb="xs">
                      <Text size="sm" weight={500}>
                        Migration {migration.id.split('_')[2]}
                      </Text>
                      {getStatusBadge(migration.status)}
                    </Group>
                    
                    {migration.status === 'running' && (
                      <>
                        <Progress value={migration.progress} size="sm" mb="xs" />
                        <Text size="xs" color="dimmed">
                          {migration.migratedFiles}/{migration.totalFiles} files ({migration.progress}%)
                        </Text>
                      </>
                    )}
                    
                    {migration.status === 'completed' && (
                      <Text size="xs" color="green">
                        ✓ {migration.migratedFiles} files migrated
                        {migration.failedFiles > 0 && ` (${migration.failedFiles} failed)`}
                      </Text>
                    )}
                    
                    {migration.status === 'failed' && (
                      <Text size="xs" color="red">
                        ✗ {migration.error}
                      </Text>
                    )}
                    
                    {migration.status === 'running' && (
                      <Button 
                        size="xs" 
                        variant="light" 
                        color="red"
                        onClick={() => cancelMigration(migration.id)}
                      >
                        Cancel
                      </Button>
                    )}
                  </Card>
                ))}
              </Stack>
            )}
          </Card>
        </Col>
      </Grid>

      {/* Migration Modal */}
      <Modal
        opened={migrationModalOpen}
        onClose={() => setMigrationModalOpen(false)}
        title="Start Migration"
        size="md"
      >
        <Stack>
          <Alert>
            <Text size="sm">
              You are about to migrate {selectedShares.size} share(s) to a different storage provider.
              This operation cannot be undone.
            </Text>
          </Alert>
          
          <Select
            label="Target Storage Provider"
            placeholder="Select target provider"
            value={targetProvider}
            onChange={(value) => setTargetProvider(value || '')}
            data={providers
              .filter(p => p.capabilities?.connected)
              .map(p => ({
                value: p.provider,
                label: p.displayName,
              }))
            }
            required
          />
          
          <Group position="right">
            <Button 
              variant="light" 
              onClick={() => setMigrationModalOpen(false)}
            >
              Cancel
            </Button>
            <Button 
              onClick={startMigration} 
              loading={startingMigration}
              disabled={!targetProvider}
            >
              Start Migration
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
};

export default MigrationManager;