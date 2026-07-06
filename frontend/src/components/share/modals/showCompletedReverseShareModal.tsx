import { Button, Stack } from "@mantine/core";
import { useModals } from "@mantine/modals";
import { ModalsContextProps } from "@mantine/modals/lib/context";
import { FormattedMessage } from "react-intl";
import { translateOutsideContext } from "../../../hooks/useTranslate.hook";
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
  const curlCommand = `curl -T file "${apiUploadUrl}"`;

  return (
    <Stack align="stretch">
      <CopyTextField link={link} />

      <CopyTextField
        link={curlCommand}
        label={t("account.reverseShares.modal.curl-command.label")}
        hideOpenLink
      />

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
