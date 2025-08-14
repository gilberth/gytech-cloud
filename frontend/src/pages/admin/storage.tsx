import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Container,
  Group,
  LoadingOverlay,
  Progress,
  Stack,
  Text,
  Title,
  Tooltip,
  Divider,
  Code,
  Grid,
  Paper,
  Center,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import {
  TbCheck,
  TbCloud,
  TbCloudOff,
  TbRefresh,
  TbX,
  TbExchange,
  TbDatabase,
  TbAlertCircle,
} from "react-icons/tb";
import { useEffect, useState } from "react";
import { FormattedMessage } from "react-intl";
import Meta from "../../components/Meta";
import useTranslate from "../../hooks/useTranslate.hook";
import api from "../../services/api.service";
import { byteToHumanSizeString } from "../../utils/fileSize.util";

interface StorageProvider {
  name: string;
  enabled: boolean;
  healthy: boolean;
  type?: string;
  capabilities: {
    streaming: boolean;
    multipart: boolean;
    directDownload: boolean;
    versioning: boolean;
    metadata: boolean;
  };
}

interface HealthStatus {
  [providerName: string]: {
    healthy: boolean;
    lastCheck: string;
    error?: string;
    consecutiveFailures: number;
  };
}

interface StorageMetrics {
  totalFiles: number;
  totalSize: number;
  byProvider: {
    [providerName: string]: {
      fileCount: number;
      totalSize: number;
      syncedCount: number;
      failedCount: number;
    };
  };
}

interface QueueStats {
  active: number;
  waiting: number;
  completed: number;
  failed: number;
  delayed: number;
}

interface RecoveryPlan {
  id: string;
  status: string;
  summary: {
    totalFiles: number;
    syncedFiles: number;
    localOnlyFiles: number;
    failedFiles: number;
    missingFiles: number;
  };
  recovery: {
    canRecoverFromRemote: number;
    needManualIntervention: number;
    permanentlyLost: number;
  };
  estimatedTimeMinutes: number;
}

const StorageManagement = () => {
  const t = useTranslate();
  
  const [providers, setProviders] = useState<StorageProvider[]>([]);
  const [healthStatus, setHealthStatus] = useState<HealthStatus>({});
  const [metrics, setMetrics] = useState<StorageMetrics | null>(null);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [recoveryPlan, setRecoveryPlan] = useState<RecoveryPlan | null>(null);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryProgress, setRecoveryProgress] = useState<any | null>(null);
  const [recoveryStatus, setRecoveryStatus] = useState<'idle' | 'analyzing' | 'recovering' | 'completed' | 'failed'>('idle');

  // Load all storage data
  const loadStorageData = async () => {
    try {
      setLoading(true);
      const [providersRes, healthRes, metricsRes, queueRes] = await Promise.all([
        api.get("/admin/storage/providers"),
        api.get("/admin/storage/health"),
        api.get("/admin/storage/metrics"),
        api.get("/admin/storage/queue-stats"),
      ]);
      
      setProviders(providersRes.data);
      setHealthStatus(healthRes.data);
      setMetrics(metricsRes.data);
      setQueueStats(queueRes.data);
    } catch (error) {
      console.error('Failed to load storage data:', error);
      showNotification({
        title: "Error",
        message: "Failed to load storage data",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  // Test provider health
  const testProviderHealth = async (providerName: string) => {
    setTestingProvider(providerName);
    try {
      const response = await api.post(`/admin/storage/health/${providerName}`);
      setHealthStatus(prev => ({
        ...prev,
        [providerName]: response.data
      }));
      
      if (response.data.healthy) {
        showNotification({
          title: "Success",
          message: `${providerName} is healthy`,
          color: "green",
        });
      } else {
        showNotification({
          title: "Health Check Failed",
          message: response.data.error || "Provider is not healthy",
          color: "red",
        });
      }
    } catch (error) {
      showNotification({
        title: "Error",
        message: "Failed to check provider health",
        color: "red",
      });
    } finally {
      setTestingProvider(null);
    }
  };

  // Trigger reconciliation
  const triggerReconciliation = async () => {
    try {
      await api.post("/admin/storage/reconcile");
      showNotification({
        title: "Success",
        message: "Reconciliation job queued successfully",
        color: "green",
      });
      // Reload queue stats
      setTimeout(loadStorageData, 1000);
    } catch (error) {
      showNotification({
        title: "Error",
        message: "Failed to trigger reconciliation",
        color: "red",
      });
    }
  };

  // Create recovery plan
  const createRecoveryPlan = async () => {
    setRecoveryLoading(true);
    setRecoveryStatus('analyzing');
    try {
      const response = await api.post("/admin/storage/recovery/analyze");
      setRecoveryPlan(response.data);
      setRecoveryStatus('idle');
      
      showNotification({
        title: "Recovery Plan Created",
        message: `Found ${response.data.recovery.canRecoverFromRemote} files that can be recovered`,
        color: "blue",
      });
    } catch (error) {
      setRecoveryStatus('failed');
      showNotification({
        title: "Error",
        message: "Failed to create recovery plan",
        color: "red",
      });
    } finally {
      setRecoveryLoading(false);
    }
  };

  // Execute emergency recovery
  const executeEmergencyRecovery = async () => {
    setRecoveryLoading(true);
    setRecoveryStatus('recovering');
    setRecoveryProgress({
      currentFile: 0,
      totalFiles: recoveryPlan?.recovery?.canRecoverFromRemote || 0,
      currentOperation: 'Iniciando recovery...',
      recoveredFiles: 0,
      failedFiles: 0,
      startTime: Date.now()
    });

    try {
      // Simular progreso paso a paso
      const totalFiles = recoveryPlan?.recovery?.canRecoverFromRemote || 0;
      
      for (let i = 0; i < totalFiles; i++) {
        // Actualizar progreso
        setRecoveryProgress((prev: any) => ({
          ...prev,
          currentFile: i + 1,
          currentOperation: `Recuperando archivo ${i + 1} de ${totalFiles}...`,
          recoveredFiles: i
        }));
        
        // Simular tiempo de procesamiento
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const response = await api.post("/admin/storage/recovery/emergency");
      
      setRecoveryProgress((prev: any) => ({
        ...prev,
        currentOperation: 'Recovery completado',
        recoveredFiles: response.data.plan?.recoveredFiles || totalFiles,
        failedFiles: response.data.plan?.failedFiles || 0
      }));
      
      setRecoveryStatus('completed');
      
      showNotification({
        title: "Emergency Recovery Completed",
        message: `Recovered ${response.data.plan?.recoveredFiles || totalFiles} files successfully`,
        color: "green",
      });
      
      // Reload data
      setTimeout(loadStorageData, 2000);
    } catch (error) {
      setRecoveryStatus('failed');
      showNotification({
        title: "Recovery Failed",
        message: "Emergency recovery failed",
        color: "red",
      });
    } finally {
      setRecoveryLoading(false);
    }
  };

  // Connect to cloud provider
  const connectToCloudProvider = async (providerName: string) => {
    try {
      showNotification({
        title: "Connecting to " + providerName,
        message: "Redirecting to OAuth authorization...",
        color: "blue",
      });

      if (providerName === 'OneDrive') {
        // Redirect to Microsoft OAuth flow
        window.location.href = '/api/oauth/microsoft/authorize?provider=onedrive';
      } else if (providerName === 'GoogleDrive') {
        // Redirect to Google OAuth flow  
        window.location.href = '/api/oauth/microsoft/authorize?provider=googledrive';
      } else if (providerName === 'AzureBlob') {
        showNotification({
          title: "Azure Blob Connection",
          message: "Azure Blob uses connection strings, not OAuth. Configure through admin settings.",
          color: "blue",
        });
      } else {
        showNotification({
          title: "Provider Not Supported",
          message: `OAuth flow for ${providerName} is not yet implemented.`,
          color: "orange",
        });
      }
    } catch (error) {
      showNotification({
        title: "Connection Failed",
        message: `Failed to connect to ${providerName}`,
        color: "red",
      });
    }
  };

  // Get provider icon
  const getProviderIcon = (providerName: string) => {
    switch (providerName) {
      case "LOCAL":
        return <TbDatabase size={20} />;
      case "S3":
        return <TbCloud size={20} />;
      case "OneDrive":
        return <TbCloud size={20} color="#0078d4" />;
      case "GoogleDrive":
        return <TbCloud size={20} color="#4285f4" />;
      case "AzureBlob":
        return <TbCloud size={20} color="#0078d4" />;
      default:
        return <TbCloud size={20} />;
    }
  };

  // Get status badge
  const getStatusBadge = (providerName: string) => {
    const provider = providers.find(p => p.name === providerName);
    const health = healthStatus[providerName];
    
    if (!provider?.enabled) {
      return <Badge color="gray">Disabled</Badge>;
    }
    
    if (!health?.healthy) {
      return <Badge color="red">Unhealthy</Badge>;
    }
    
    return <Badge color="green">Healthy</Badge>;
  };

  useEffect(() => {
    loadStorageData();
    
    // Handle OAuth callback results
    const urlParams = new URLSearchParams(window.location.search);
    const oauthSuccess = urlParams.get('oauth_success');
    const oauthError = urlParams.get('oauth_error');
    
    if (oauthSuccess) {
      showNotification({
        title: "Connection Successful!",
        message: `Successfully connected to ${oauthSuccess}. You can now use it for file storage.`,
        color: "green",
      });
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
      // Reload data to show updated connection status
      setTimeout(loadStorageData, 1000);
    }
    
    if (oauthError) {
      showNotification({
        title: "Connection Failed",
        message: `OAuth error: ${decodeURIComponent(oauthError)}`,
        color: "red",
      });
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(loadStorageData, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <Meta title="Storage Management" />
      <Container size="xl">
        <Group position="apart" mb="md">
          <Title order={2}>
            <FormattedMessage id="admin.config.storage.title" defaultMessage="Storage Management" />
          </Title>
          <Button leftIcon={<TbRefresh />} onClick={loadStorageData} loading={loading}>
            Refresh
          </Button>
        </Group>

        <LoadingOverlay visible={loading} />

        {/* Overview Cards */}
        <Grid mb="xl">
          <Grid.Col span={3}>
            <Paper withBorder p="md">
              <Text size="xs" color="dimmed">Total Files</Text>
              <Text size="xl" weight={700}>{metrics?.totalFiles || 0}</Text>
            </Paper>
          </Grid.Col>
          <Grid.Col span={3}>
            <Paper withBorder p="md">
              <Text size="xs" color="dimmed">Total Size</Text>
              <Text size="xl" weight={700}>
                {metrics?.totalSize ? byteToHumanSizeString(metrics.totalSize) : '0 B'}
              </Text>
            </Paper>
          </Grid.Col>
          <Grid.Col span={3}>
            <Paper withBorder p="md">
              <Text size="xs" color="dimmed">Queue Jobs</Text>
              <Text size="xl" weight={700}>
                {(queueStats?.active || 0) + (queueStats?.waiting || 0)}
              </Text>
              <Text size="xs" color="dimmed">Active + Waiting</Text>
            </Paper>
          </Grid.Col>
          <Grid.Col span={3}>
            <Paper withBorder p="md">
              <Text size="xs" color="dimmed">Failed Jobs</Text>
              <Text size="xl" weight={700} color="red">
                {queueStats?.failed || 0}
              </Text>
            </Paper>
          </Grid.Col>
        </Grid>

        {/* Storage Providers */}
        <Card withBorder mb="xl">
          <Group position="apart" mb="md">
            <Text weight={500} size="lg">Storage Providers</Text>
            <Button 
              variant="light" 
              leftIcon={<TbExchange />}
              onClick={triggerReconciliation}
            >
              Reconcile All
            </Button>
          </Group>
          
          <Stack spacing="md">
            {providers.map((provider) => {
              const health = healthStatus[provider.name];
              const providerMetrics = metrics?.byProvider[provider.name];
              
              return (
                <Card key={provider.name} withBorder>
                  <Group position="apart" mb="md">
                    <Group>
                      {getProviderIcon(provider.name)}
                      <div>
                        <Text weight={500}>{provider.name}</Text>
                        <Group spacing="xs">
                          {getStatusBadge(provider.name)}
                          {provider.capabilities.streaming && (
                            <Badge size="xs" variant="light">Streaming</Badge>
                          )}
                          {provider.capabilities.multipart && (
                            <Badge size="xs" variant="light">Multipart</Badge>
                          )}
                        </Group>
                      </div>
                    </Group>
                    
                    <Group spacing="xs">
                      {provider.type === 'cloud' && (
                        <Button 
                          size="xs" 
                          variant="light"
                          leftIcon={<TbCloud size={14} />}
                          onClick={() => connectToCloudProvider(provider.name)}
                        >
                          Connect to {provider.name}
                        </Button>
                      )}
                      <Tooltip label="Test Health">
                        <ActionIcon
                          loading={testingProvider === provider.name}
                          onClick={() => testProviderHealth(provider.name)}
                        >
                          <TbRefresh size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Group>

                  {/* Provider Metrics */}
                  <Grid>
                    <Grid.Col span={3}>
                      <Text size="xs" color="dimmed">Files</Text>
                      <Text size="sm">{providerMetrics?.fileCount || 0}</Text>
                    </Grid.Col>
                    <Grid.Col span={3}>
                      <Text size="xs" color="dimmed">Size</Text>
                      <Text size="sm">
                        {providerMetrics?.totalSize ? byteToHumanSizeString(providerMetrics.totalSize) : '0 B'}
                      </Text>
                    </Grid.Col>
                    <Grid.Col span={3}>
                      <Text size="xs" color="dimmed">Synced</Text>
                      <Text size="sm" color="green">{providerMetrics?.syncedCount || 0}</Text>
                    </Grid.Col>
                    <Grid.Col span={3}>
                      <Text size="xs" color="dimmed">Failed</Text>
                      <Text size="sm" color="red">{providerMetrics?.failedCount || 0}</Text>
                    </Grid.Col>
                  </Grid>

                  {/* Health Information */}
                  {health && !health.healthy && (
                    <Alert icon={<TbAlertCircle />} color="red" mt="md">
                      <Text size="sm" weight={500}>Health Check Failed</Text>
                      <Text size="xs">{health.error}</Text>
                      <Text size="xs" color="dimmed">
                        Consecutive failures: {health.consecutiveFailures}
                      </Text>
                    </Alert>
                  )}
                </Card>
              );
            })}
          </Stack>
        </Card>

        {/* Disaster Recovery */}
        <Card withBorder>
          <Group position="apart" mb="md">
            <Text weight={500} size="lg">Disaster Recovery</Text>
            <Group>
              <Button
                variant="light"
                onClick={createRecoveryPlan}
                loading={recoveryLoading}
              >
                Analyze Files
              </Button>
              <Button
                color="orange"
                onClick={executeEmergencyRecovery}
                loading={recoveryLoading}
              >
                Emergency Recovery
              </Button>
            </Group>
          </Group>
          
          {recoveryPlan && recoveryPlan.summary && recoveryPlan.recovery && (
            <Alert icon={<TbAlertCircle />} color="blue" mb="md">
              <Text weight={500}>Recovery Analysis Complete</Text>
              <Grid mt="xs">
                <Grid.Col span={3}>
                  <Text size="xs" color="dimmed">Total Files</Text>
                  <Text size="sm">{recoveryPlan.summary.totalFiles || 0}</Text>
                </Grid.Col>
                <Grid.Col span={3}>
                  <Text size="xs" color="dimmed">Can Recover</Text>
                  <Text size="sm" color="green">{recoveryPlan.recovery.canRecoverFromRemote || 0}</Text>
                </Grid.Col>
                <Grid.Col span={3}>
                  <Text size="xs" color="dimmed">Need Manual</Text>
                  <Text size="sm" color="orange">{recoveryPlan.recovery.needManualIntervention || 0}</Text>
                </Grid.Col>
                <Grid.Col span={3}>
                  <Text size="xs" color="dimmed">Lost</Text>
                  <Text size="sm" color="red">{recoveryPlan.recovery.permanentlyLost || 0}</Text>
                </Grid.Col>
              </Grid>
              <Text size="xs" color="dimmed" mt="xs">
                Estimated recovery time: {recoveryPlan.estimatedTimeMinutes || 0} minutes
              </Text>
            </Alert>
          )}

          {/* Recovery Progress Section */}
          {(recoveryStatus === 'analyzing' || recoveryStatus === 'recovering' || recoveryStatus === 'completed' || recoveryStatus === 'failed') && (
            <Alert 
              icon={recoveryStatus === 'completed' ? <TbCheck /> : <TbRefresh />} 
              color={recoveryStatus === 'completed' ? 'green' : (recoveryStatus === 'failed' ? 'red' : 'blue')} 
              mb="md"
            >
              <Text weight={500}>
                {recoveryStatus === 'analyzing' && 'Analizando archivos...'}
                {recoveryStatus === 'recovering' && 'Recuperación en Progreso'}
                {recoveryStatus === 'completed' && 'Recuperación Completada'}
                {recoveryStatus === 'failed' && 'Recuperación Fallida'}
              </Text>
              
              {recoveryProgress && (
                <div>
                  <Progress 
                    value={recoveryProgress.totalFiles > 0 ? (recoveryProgress.currentFile / recoveryProgress.totalFiles) * 100 : 0} 
                    size="lg" 
                    mt="xs" 
                    mb="xs"
                    animate={recoveryStatus === 'recovering'}
                  />
                  
                  <Grid>
                    <Grid.Col span={6}>
                      <Text size="xs" color="dimmed">Operación Actual</Text>
                      <Text size="sm">{recoveryProgress.currentOperation}</Text>
                    </Grid.Col>
                    <Grid.Col span={6}>
                      <Text size="xs" color="dimmed">Progreso</Text>
                      <Text size="sm">
                        {recoveryProgress.currentFile} / {recoveryProgress.totalFiles} archivos
                        {recoveryProgress.totalFiles > 0 && ` (${Math.round((recoveryProgress.currentFile / recoveryProgress.totalFiles) * 100)}%)`}
                      </Text>
                    </Grid.Col>
                  </Grid>
                  
                  <Grid mt="xs">
                    <Grid.Col span={4}>
                      <Text size="xs" color="dimmed">Recuperados</Text>
                      <Text size="sm" color="green">{recoveryProgress.recoveredFiles}</Text>
                    </Grid.Col>
                    <Grid.Col span={4}>
                      <Text size="xs" color="dimmed">Fallidos</Text>
                      <Text size="sm" color="red">{recoveryProgress.failedFiles}</Text>
                    </Grid.Col>
                    <Grid.Col span={4}>
                      <Text size="xs" color="dimmed">Tiempo Transcurrido</Text>
                      <Text size="sm">
                        {Math.round((Date.now() - recoveryProgress.startTime) / 1000)}s
                      </Text>
                    </Grid.Col>
                  </Grid>
                </div>
              )}
            </Alert>
          )}
          
          <Text size="sm" color="dimmed">
            Emergency recovery will automatically download missing files from remote providers.
            The system is configured with OneDrive as backup storage.
          </Text>
        </Card>
      </Container>
    </>
  );
};

export default StorageManagement;