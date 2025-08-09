import {
  Select,
  Group,
  Avatar,
  Text,
  Badge,
  Tooltip,
  ActionIcon,
  Alert,
} from "@mantine/core";
import { TbCloud, TbDatabase, TbInfoCircle } from "react-icons/tb";
import { forwardRef, useEffect, useState } from "react";
import api from "../../services/api.service";
import { byteToHumanSizeString } from "../../utils/fileSize.util";

interface StorageProvider {
  provider: string;
  displayName: string;
  enabled: boolean;
  capabilities?: {
    features: string[];
    availableSpace: number | null;
    connected: boolean;
  };
}

interface StorageProviderItemProps extends React.ComponentPropsWithoutRef<"div"> {
  provider: string;
  displayName: string;
  capabilities?: {
    features: string[];
    availableSpace: number | null;
    connected: boolean;
  };
}

const StorageProviderItem = forwardRef<HTMLDivElement, StorageProviderItemProps>(
  ({ provider, displayName, capabilities, ...others }, ref) => {
    const getProviderIcon = (providerType: string) => {
      switch (providerType) {
        case "LOCAL":
          return <TbDatabase size={20} />;
        case "S3":
          return <TbCloud size={20} />;
        case "ONEDRIVE":
          return <TbCloud size={20} color="#0078d4" />;
        case "GOOGLE_DRIVE":
          return <TbCloud size={20} color="#4285f4" />;
        case "AZURE_BLOB":
          return <TbCloud size={20} color="#0078d4" />;
        default:
          return <TbCloud size={20} />;
      }
    };

    return (
      <div ref={ref} {...others}>
        <Group>
          <Avatar size="sm" radius="sm">
            {getProviderIcon(provider)}
          </Avatar>

          <div style={{ flex: 1 }}>
            <Group position="apart">
              <Text size="sm" weight={500}>
                {displayName}
              </Text>
              {!capabilities?.connected ? (
                <Badge size="xs" color="red">
                  Offline
                </Badge>
              ) : (
                <Badge size="xs" color="green">
                  Online
                </Badge>
              )}
            </Group>
            
            <Group spacing="xs" mt="xs">
              <Text size="xs" color="dimmed">
                Space: {capabilities?.availableSpace 
                  ? byteToHumanSizeString(capabilities.availableSpace)
                  : "Unlimited"
                }
              </Text>
              {capabilities?.features && capabilities.features.length > 0 && (
                <Text size="xs" color="dimmed">
                  • {capabilities.features.length} features
                </Text>
              )}
            </Group>
          </div>
        </Group>
      </div>
    );
  }
);

StorageProviderItem.displayName = "StorageProviderItem";

interface StorageProviderSelectorProps {
  value?: string;
  onChange: (provider: string) => void;
  disabled?: boolean;
  showInfo?: boolean;
}

const StorageProviderSelector: React.FC<StorageProviderSelectorProps> = ({
  value,
  onChange,
  disabled = false,
  showInfo = true,
}) => {
  const [providers, setProviders] = useState<StorageProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [defaultProvider, setDefaultProvider] = useState<string>("LOCAL");

  const loadProviders = async () => {
    try {
      const [providersResponse, defaultResponse] = await Promise.all([
        api.get("/admin/storage/providers"),
        api.get("/admin/storage/default"),
      ]);
      
      // Only include enabled and connected providers
      const enabledProviders = providersResponse.data.filter(
        (p: StorageProvider) => p.enabled && p.capabilities?.connected
      );
      
      setProviders(enabledProviders);
      setDefaultProvider(defaultResponse.data.provider);
      
      // Set default value if none provided
      if (!value) {
        onChange(defaultResponse.data.provider);
      }
    } catch (error) {
      console.error("Failed to load storage providers:", error);
      // Fallback to LOCAL provider
      setProviders([{
        provider: "LOCAL",
        displayName: "Local Storage",
        enabled: true,
        capabilities: {
          features: ["chunked_upload"],
          availableSpace: null,
          connected: true,
        },
      }]);
      setDefaultProvider("LOCAL");
      if (!value) {
        onChange("LOCAL");
      }
    } finally {
      setLoading(false);
    }
  };

  const getSelectedProvider = () => {
    return providers.find(p => p.provider === value) || providers[0];
  };

  useEffect(() => {
    loadProviders();
  }, []);

  if (loading) {
    return (
      <Select
        label="Storage Provider"
        placeholder="Loading providers..."
        disabled
        data={[]}
      />
    );
  }

  const selectedProvider = getSelectedProvider();

  return (
    <>
      <Select
        label="Storage Provider"
        placeholder="Choose storage provider"
        value={value || defaultProvider}
        onChange={onChange}
        disabled={disabled}
        data={providers.map(p => ({
          value: p.provider,
          label: p.displayName,
          provider: p.provider,
          displayName: p.displayName,
          capabilities: p.capabilities,
        }))}
        itemComponent={StorageProviderItem}
        searchable={false}
        maxDropdownHeight={300}
        icon={selectedProvider ? (
          selectedProvider.provider === "LOCAL" ? <TbDatabase size={16} /> : <TbCloud size={16} />
        ) : undefined}
        rightSection={
          showInfo && selectedProvider && (
            <Tooltip
              label={`Features: ${selectedProvider.capabilities?.features.join(", ") || "None"}`}
              multiline
              width={220}
            >
              <ActionIcon size="xs" variant="transparent">
                <TbInfoCircle size={12} />
              </ActionIcon>
            </Tooltip>
          )
        }
      />
      
      {showInfo && selectedProvider && !selectedProvider.capabilities?.connected && (
        <Alert color="yellow" mt="xs">
          <Text size="xs">
            Warning: Selected storage provider is not connected. Files may not be uploaded successfully.
          </Text>
        </Alert>
      )}
      
      {showInfo && selectedProvider?.capabilities?.availableSpace !== null && 
       selectedProvider.capabilities.availableSpace < 100 * 1024 * 1024 && ( // Less than 100MB
        <Alert color="orange" mt="xs">
          <Text size="xs">
            Warning: Low storage space remaining ({byteToHumanSizeString(selectedProvider.capabilities.availableSpace)}).
          </Text>
        </Alert>
      )}
    </>
  );
};

export default StorageProviderSelector;