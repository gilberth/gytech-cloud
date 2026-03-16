import { Box, Text, useMantineTheme } from "@mantine/core";
import { TbCircleCheck } from "react-icons/tb";
import { TbAlertTriangle } from "react-icons/tb";

const UploadProgressIndicator = ({ progress }: { progress: number }) => {
  const theme = useMantineTheme();
  const isDark = theme.colorScheme === "dark";

  if (progress >= 100) {
    return <TbCircleCheck color={theme.colors.green[6]} size={22} />;
  }

  if (progress < 0) {
    return <TbAlertTriangle color={theme.colors.red[6]} size={22} />;
  }

  const displayProgress = Math.round(progress);
  const victoriaColor = theme.colors.victoria?.[6] ?? theme.primaryColor;
  const trackColor = isDark ? theme.colors.dark[5] : theme.colors.gray[2];

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        minWidth: 120,
      }}
    >
      <Box
        sx={{
          flex: 1,
          height: 6,
          borderRadius: 3,
          backgroundColor: trackColor,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <Box
          sx={{
            height: "100%",
            width: `${displayProgress}%`,
            borderRadius: 3,
            backgroundColor: victoriaColor,
            transition: "width 150ms ease",
          }}
        />
      </Box>
      <Text
        size="xs"
        weight={600}
        sx={{
          minWidth: 36,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          color: isDark ? theme.colors.dark[1] : theme.colors.gray[7],
        }}
      >
        {displayProgress}%
      </Text>
    </Box>
  );
};

export default UploadProgressIndicator;
