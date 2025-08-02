import { Button, Stack, Text } from "@mantine/core";
import { useModals } from "@mantine/modals";
import { ModalsContextProps } from "@mantine/modals/lib/context";
import moment from "moment";
import { useRouter } from "next/router";
import { FormattedMessage } from "react-intl";
import useTranslate, {
  translateOutsideContext,
} from "../../../hooks/useTranslate.hook";
import { CompletedShare } from "../../../types/share.type";
import CopyTextField from "../CopyTextField";

const showCompletedUploadModal = (
  modals: ModalsContextProps,
  share: CompletedShare,
) => {
  const t = translateOutsideContext();
  return modals.openModal({
    closeOnClickOutside: false,
    withCloseButton: false,
    closeOnEscape: false,
    title: t("upload.modal.completed.share-ready"),
    children: <Body share={share} />,
  });
};

const Body = ({ share }: { share: CompletedShare }) => {
  const modals = useModals();
  const router = useRouter();
  const t = useTranslate();

  const isReverseShare = !!router.query["reverseShareToken"];

  // Generate direct download URLs instead of shortened share URL
  const generateDirectLinks = () => {
    const baseUrl = `${window.location.origin}/api/shares/${share.id}/files`;
    
    // If only one file, provide direct file download URL with filename
    // If multiple files, use ZIP download
    if (share.files?.length === 1) {
      const file = share.files[0];
      // Create friendly URL with filename
      const encodedFilename = encodeURIComponent(file.name);
      return `${baseUrl}/${file.id}/${encodedFilename}`;
    } else {
      return `${baseUrl}/zip`;
    }
  };

  const link = generateDirectLinks();

  return (
    <Stack align="stretch">
      <CopyTextField link={link} />
      
      {/* Show download info */}
      <Text
        size="sm"
        sx={(theme) => ({
          color:
            theme.colorScheme === "dark"
              ? theme.colors.blue[4]
              : theme.colors.blue[6],
          fontWeight: 500,
        })}
      >
        {share.files?.length === 1 
          ? `📄 Descarga directa: ${share.files[0].name}`
          : `📦 Descarga ZIP (${share.files?.length || 0} archivos)`
        }
      </Text>
      
      {share.notifyReverseShareCreator === true && (
        <Text
          size="sm"
          sx={(theme) => ({
            color:
              theme.colorScheme === "dark"
                ? theme.colors.gray[3]
                : theme.colors.dark[4],
          })}
        >
          {t("upload.modal.completed.notified-reverse-share-creator")}
        </Text>
      )}
      <Text
        size="xs"
        sx={(theme) => ({
          color: theme.colors.gray[6],
        })}
      >
        {/* If our share.expiration is timestamp 0, show a different message */}
        {moment(share.expiration).unix() === 0
          ? t("upload.modal.completed.never-expires")
          : t("upload.modal.completed.expires-on", {
              expiration: moment(share.expiration).format("LLL"),
            })}
      </Text>

      <Button
        onClick={() => {
          modals.closeAll();
          if (isReverseShare) {
            router.reload();
          } else {
            router.push("/upload");
          }
        }}
      >
        <FormattedMessage id="common.button.done" />
      </Button>
    </Stack>
  );
};

export default showCompletedUploadModal;
