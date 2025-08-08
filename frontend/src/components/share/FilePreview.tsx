import {
  Button,
  Center,
  Stack,
  Text,
  Title,
  useMantineTheme,
  Group,
  Badge,
  Loader,
  Alert,
  Box,
  Divider,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import Markdown, { MarkdownToJSX } from "markdown-to-jsx";
import Link from "next/link";
import React, { Dispatch, SetStateAction, useEffect, useState } from "react";
import { FormattedMessage } from "react-intl";
import { TbExternalLink, TbDownload, TbCopy } from "react-icons/tb";
import api from "../../services/api.service";
import { byteToHumanSizeString } from "../../utils/fileSize.util";

interface FileMetadata {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  supportsPreview: boolean;
  previewType: string;
}

const FilePreviewContext = React.createContext<{
  shareId: string;
  fileId: string;
  mimeType: string;
  fileName?: string;
  fileSize?: number;
  setIsNotSupported: Dispatch<SetStateAction<boolean>>;
}>({
  shareId: "",
  fileId: "",
  mimeType: "",
  setIsNotSupported: () => {},
});

const FilePreview = ({
  shareId,
  fileId,
  mimeType,
  fileName,
  fileSize,
}: {
  shareId: string;
  fileId: string;
  mimeType: string;
  fileName?: string;
  fileSize?: number;
}) => {
  const [isNotSupported, setIsNotSupported] = useState(false);
  const [metadata, setMetadata] = useState<FileMetadata | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log(`[DEBUG] FilePreview useEffect - shareId: ${shareId}, fileId: ${fileId}`);
    
    // Fetch file metadata for enhanced preview
    api.get(`/shares/${shareId}/files/${fileId}/metadata`)
      .then((response) => {
        console.log(`[DEBUG] Metadata response:`, response.data);
        setMetadata(response.data);
        if (!response.data.supportsPreview) {
          console.log(`[DEBUG] File does not support preview`);
          setIsNotSupported(true);
        }
      })
      .catch((error) => {
        console.error(`[DEBUG] Metadata request failed:`, error);
        setIsNotSupported(true);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [shareId, fileId]);

  if (loading) {
    return (
      <Center style={{ minHeight: 200 }}>
        <Stack align="center" spacing="sm">
          <Loader />
          <Text size="sm" color="dimmed">
            Loading preview...
          </Text>
        </Stack>
      </Center>
    );
  }

  if (isNotSupported || !metadata) return <UnSupportedFile />;

  const contextValue = {
    shareId,
    fileId,
    mimeType: metadata.mimeType,
    fileName: metadata.name,
    fileSize: metadata.size,
    setIsNotSupported,
  };

  return (
    <Stack spacing="md">
      {/* File info header */}
      <Box>
        <Group position="apart" mb="xs">
          <Group spacing="xs">
            <Badge variant="light" color="blue">
              {metadata.previewType.toUpperCase()}
            </Badge>
            <Text size="sm" color="dimmed">
              {byteToHumanSizeString(metadata.size)}
            </Text>
          </Group>
        </Group>
        <Divider />
      </Box>

      <FilePreviewContext.Provider value={contextValue}>
        <FileDecider previewType={metadata.previewType} />
      </FilePreviewContext.Provider>

      {/* Action buttons */}
      <Group position="center" spacing="sm" mt="md">
        <Button
          variant="light"
          component="a"
          target="_blank"
          href={`/api/shares/${shareId}/files/${fileId}?download=false&preview=true`}
          leftIcon={<TbExternalLink size={16} />}
        >
          Open in new tab
        </Button>
        <Button
          variant="outline"
          component="a"
          href={`/api/shares/${shareId}/files/${fileId}?download=true`}
          leftIcon={<TbDownload size={16} />}
        >
          Download
        </Button>
      </Group>
    </Stack>
  );
};

const FileDecider = ({ previewType }: { previewType: string }) => {
  const { setIsNotSupported } = React.useContext(FilePreviewContext);

  switch (previewType) {
    case "pdf":
      return <PdfPreview />;
    case "video":
      return <VideoPreview />;
    case "image":
      return <ImagePreview />;
    case "audio":
      return <AudioPreview />;
    case "text":
      return <TextPreview />;
    case "code":
      return <CodePreview />;
    case "office":
      return <OfficePreview />;
    default:
      setIsNotSupported(true);
      return null;
  }
};

const AudioPreview = () => {
  const { shareId, fileId, fileName, setIsNotSupported } =
    React.useContext(FilePreviewContext);

  return (
    <Center style={{ minHeight: 200 }}>
      <Stack align="center" spacing="md" style={{ width: "100%" }}>
        <audio
          controls
          style={{ width: "100%", maxWidth: "400px" }}
          preload="metadata"
          onError={() => setIsNotSupported(true)}
        >
          <source
            src={`/api/shares/${shareId}/files/${fileId}?download=false&preview=true`}
          />
          Your browser does not support the audio element.
        </audio>
        {fileName && (
          <Text size="sm" color="dimmed" weight={500}>
            {fileName}
          </Text>
        )}
      </Stack>
    </Center>
  );
};

const VideoPreview = () => {
  const { shareId, fileId, fileName, setIsNotSupported } =
    React.useContext(FilePreviewContext);

  return (
    <Box style={{ textAlign: "center" }}>
      <video
        width="100%"
        style={{ maxHeight: "500px", borderRadius: "8px" }}
        controls
        preload="metadata"
        onError={() => setIsNotSupported(true)}
      >
        <source
          src={`/api/shares/${shareId}/files/${fileId}?download=false&preview=true`}
        />
        Your browser does not support the video tag.
      </video>
      {fileName && (
        <Text size="sm" color="dimmed" mt="xs">
          {fileName}
        </Text>
      )}
    </Box>
  );
};

const ImagePreview = () => {
  const { shareId, fileId, fileName, setIsNotSupported } =
    React.useContext(FilePreviewContext);
  const [loading, setLoading] = useState(true);

  return (
    <Box style={{ textAlign: "center", maxHeight: "600px", overflow: "auto" }}>
      {loading && (
        <Center style={{ position: "absolute", inset: 0, zIndex: 1 }}>
          <Loader />
        </Center>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/shares/${shareId}/files/${fileId}?download=false&preview=true`}
        alt={fileName || `${fileId}_preview`}
        style={{
          maxWidth: "100%",
          maxHeight: "600px",
          objectFit: "contain",
          borderRadius: "8px",
        }}
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setIsNotSupported(true);
        }}
      />
    </Box>
  );
};

const TextPreview = () => {
  const { shareId, fileId, fileName } = React.useContext(FilePreviewContext);
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const { colorScheme } = useMantineTheme();

  useEffect(() => {
    api
      .get(`/shares/${shareId}/files/${fileId}?download=false`)
      .then((res) => setText(res.data ?? "Preview couldn't be fetched."))
      .catch(() => setText("Error loading text content."))
      .finally(() => setLoading(false));
  }, [shareId, fileId]);

  if (loading) {
    return (
      <Center style={{ minHeight: 200 }}>
        <Stack align="center" spacing="sm">
          <Loader size="sm" />
          <Text size="sm" color="dimmed">Loading text...</Text>
        </Stack>
      </Center>
    );
  }

  const isMarkdown = fileName?.toLowerCase().endsWith('.md') || fileName?.toLowerCase().endsWith('.markdown');

  if (isMarkdown) {
    const options: MarkdownToJSX.Options = {
      disableParsingRawHTML: true,
      overrides: {
        pre: {
          props: {
            style: {
              backgroundColor:
                colorScheme == "dark"
                  ? "rgba(50, 50, 50, 0.5)"
                  : "rgba(220, 220, 220, 0.5)",
              padding: "0.75em",
              whiteSpace: "pre-wrap",
              borderRadius: "4px",
            },
          },
        },
        table: {
          props: {
            className: "md",
          },
        },
      },
    };

    return (
      <Box style={{ maxHeight: "500px", overflow: "auto", padding: "1rem" }}>
        <Markdown options={options}>{text}</Markdown>
      </Box>
    );
  }

  // Plain text preview
  return (
    <Box
      style={{
        maxHeight: "500px",
        overflow: "auto",
        padding: "1rem",
        backgroundColor: colorScheme === "dark" ? "rgba(50, 50, 50, 0.3)" : "rgba(220, 220, 220, 0.3)",
        borderRadius: "8px",
        fontFamily: "monospace",
        fontSize: "14px",
        lineHeight: "1.5",
      }}
    >
      <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{text}</pre>
    </Box>
  );
};

const PdfPreview = () => {
  const { shareId, fileId } = React.useContext(FilePreviewContext);
  const [loadError, setLoadError] = useState(false);

  if (loadError) {
    return (
      <Alert color="orange" title="PDF Preview Not Available">
        <Text size="sm" mb="md">
          This PDF cannot be previewed inline. Please download or open in a new tab.
        </Text>
      </Alert>
    );
  }

  return (
    <Box style={{ height: "600px", width: "100%" }}>
      <iframe
        src={`/api/shares/${shareId}/files/${fileId}?download=false&preview=true`}
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          borderRadius: "8px",
        }}
        onError={() => setLoadError(true)}
        title="PDF Preview"
      />
    </Box>
  );
};

const CodePreview = () => {
  const { shareId, fileId, fileName } = React.useContext(FilePreviewContext);
  const [code, setCode] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const { colorScheme } = useMantineTheme();

  const getLanguageFromFileName = (fileName: string = ""): string => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const languageMap: Record<string, string> = {
      'js': 'JavaScript',
      'jsx': 'JSX',
      'ts': 'TypeScript',
      'tsx': 'TSX',
      'py': 'Python',
      'java': 'Java',
      'cpp': 'C++',
      'c': 'C',
      'h': 'C Header',
      'css': 'CSS',
      'html': 'HTML',
      'xml': 'XML',
      'json': 'JSON',
      'yaml': 'YAML',
      'yml': 'YAML',
    };
    return languageMap[ext] || 'Text';
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  useEffect(() => {
    api
      .get(`/shares/${shareId}/files/${fileId}?download=false`)
      .then((res) => {
        setCode(res.data || "// File content could not be loaded");
      })
      .catch(() => {
        setCode("// Error loading file content");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [shareId, fileId]);

  if (loading) {
    return (
      <Center style={{ minHeight: 200 }}>
        <Stack align="center" spacing="sm">
          <Loader size="sm" />
          <Text size="sm" color="dimmed">Loading code...</Text>
        </Stack>
      </Center>
    );
  }

  return (
    <Box>
      {/* Code header with language and copy button */}
      <Group position="apart" mb="xs" p="xs" sx={(theme) => ({
        backgroundColor: colorScheme === 'dark' ? theme.colors.dark[6] : theme.colors.gray[1],
        borderRadius: '8px 8px 0 0',
        border: `1px solid ${colorScheme === 'dark' ? theme.colors.dark[4] : theme.colors.gray[3]}`,
        borderBottom: 'none',
      })}>
        <Badge variant="light" size="sm">
          {getLanguageFromFileName(fileName)}
        </Badge>
        <Button
          variant="subtle"
          size="xs"
          leftIcon={<TbCopy size={14} />}
          onClick={copyToClipboard}
          color={copied ? 'green' : 'gray'}
        >
          {copied ? 'Copied!' : 'Copy'}
        </Button>
      </Group>
      
      {/* Code content */}
      <Box
        style={{
          maxHeight: "500px",
          overflow: "auto",
          backgroundColor: colorScheme === "dark" ? "#1a1a1a" : "#f8f9fa",
          border: `1px solid ${colorScheme === "dark" ? "#333" : "#e9ecef"}`,
          borderRadius: "0 0 8px 8px",
          fontFamily: "'Fira Code', 'Monaco', 'Menlo', 'Ubuntu Mono', monospace",
          fontSize: "14px",
          lineHeight: "1.5",
        }}
      >
        <pre style={{ 
          margin: 0, 
          padding: "1rem", 
          whiteSpace: "pre-wrap",
          color: colorScheme === "dark" ? "#f8f8f2" : "#212529"
        }}>
          {code}
        </pre>
      </Box>
    </Box>
  );
};

const OfficePreview = () => {
  const { shareId, fileId, fileName } = React.useContext(FilePreviewContext);
  const [useGoogleViewer, setUseGoogleViewer] = useState(true);

  const googleViewerUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(
    `${window.location.origin}/api/shares/${shareId}/files/${fileId}?download=false`
  )}&embedded=true`;

  if (!useGoogleViewer) {
    return (
      <Alert color="blue" title="Office Document Preview">
        <Text size="sm" mb="md">
          This Office document cannot be previewed inline. Please download the file to view it.
        </Text>
        <Text size="xs" color="dimmed">
          Supported formats: .doc, .docx, .xls, .xlsx, .ppt, .pptx
        </Text>
      </Alert>
    );
  }

  return (
    <Box style={{ height: "600px", width: "100%" }}>
      <iframe
        src={googleViewerUrl}
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          borderRadius: "8px",
        }}
        onError={() => setUseGoogleViewer(false)}
        title={`Office Document Preview - ${fileName}`}
      />
    </Box>
  );
};

const UnSupportedFile = () => {
  return (
    <Center style={{ minHeight: 200 }}>
      <Stack align="center" spacing="md">
        <Alert color="yellow" title="Preview Not Available">
          <Text size="sm">
            This file type cannot be previewed in the browser. Please download the file to view its contents.
          </Text>
          <Text size="xs" color="dimmed" mt="sm">
            Supported preview formats: Images, Videos, Audio, PDFs, Text files, Code files, and Office documents.
          </Text>
        </Alert>
      </Stack>
    </Center>
  );
};

export default FilePreview;
