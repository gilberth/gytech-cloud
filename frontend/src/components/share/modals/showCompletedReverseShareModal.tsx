import { Button, Stack, Text } from "@mantine/core";
import { useModals } from "@mantine/modals";
import { ModalsContextProps } from "@mantine/modals/lib/context";
import { FormattedMessage } from "react-intl";
import { translateOutsideContext } from "../../../hooks/useTranslate.hook";
import {
  buildPosixCurlCommand,
  buildPowerShellCurlCommand,
} from "../../../utils/curlCommand.util";
import CopyTextField from "../../upload/CopyTextField";

const showCompletedReverseShareModal = (
  modals: ModalsContextProps,
  link: string,
  apiUploadUrl: string,
  getReverseShares: () => void,
) => {
  const t = translateOutsideContext();
  return modals.openModal({
    closeOnClickOutside: false,
    withCloseButton: false,
    closeOnEscape: false,
    title: t("account.reverseShares.modal.reverse-share-link"),
    children: (
      <Body
        link={link}
        apiUploadUrl={apiUploadUrl}
        getReverseShares={getReverseShares}
      />
    ),
  });
};

const Body = ({
  link,
  apiUploadUrl,
  getReverseShares,
}: {
  link: string;
  apiUploadUrl: string;
  getReverseShares: () => void;
}) => {
  const modals = useModals();
  const t = translateOutsideContext();
  const posixCurlCommand = buildPosixCurlCommand(apiUploadUrl);
  const powerShellCurlCommand = buildPowerShellCurlCommand(apiUploadUrl);

  return (
    <Stack align="stretch">
      <CopyTextField link={link} />

      <div>
        <Text mb="xs" weight={500}>
          {t("account.reverseShares.modal.curl-command.label")}
        </Text>
        <Text mb="sm" size="sm" color="dimmed">
          {t("account.reverseShares.modal.curl-command.description")}
        </Text>

        <Stack spacing="sm">
          <CopyTextField
            link={posixCurlCommand}
            label={t("account.reverseShares.modal.curl-command.posix")}
            hideOpenLink
          />
          <div>
            <CopyTextField
              link={powerShellCurlCommand}
              label={t("account.reverseShares.modal.curl-command.powershell")}
              hideOpenLink
            />
            <Text mt={4} size="xs" color="dimmed">
              {t(
                "account.reverseShares.modal.curl-command.powershell-description",
              )}
            </Text>
          </div>
        </Stack>
      </div>

      <Button
        onClick={() => {
          modals.closeAll();
          getReverseShares();
        }}
      >
        <FormattedMessage id="common.button.done" />
      </Button>
    </Stack>
  );
};

export default showCompletedReverseShareModal;
