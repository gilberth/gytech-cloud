import { Button, Stack, Text, TextInput, Textarea, Box, Group, PasswordInput, Switch, Select } from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { useForm } from "@mantine/form";
import { ModalsContextProps } from "@mantine/modals/lib/context";
import moment from "moment";
import { useState } from "react";
import { FormattedMessage } from "react-intl";
import { translateOutsideContext } from "../../hooks/useTranslate.hook";
import { MyShare } from "../../types/share.type";
import shareService from "../../services/share.service";
import toast from "../../utils/toast.util";

interface ShareEditModalProps {
  share: MyShare;
  onShareUpdated: () => void;
  onClose: () => void;
}

const ShareEditModal = ({ share, onShareUpdated, onClose }: ShareEditModalProps) => {
  const t = translateOutsideContext();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm({
    initialValues: {
      name: share.name || "",
      description: share.description || "",
      expiration: share.expiration ? new Date(share.expiration) : null,
      hasPassword: !!share.security?.passwordProtected,
      password: "",
    },
    validate: {
      name: (value) => {
        // Name is optional, only validate if it has content
        if (!value || value.trim() === "") return null;
        if (value.length < 3) return "El nombre debe tener al menos 3 caracteres";
        if (value.length > 30) return "El nombre no puede tener más de 30 caracteres";
        return null;
      },
      description: (value) => 
        value && value.length > 512 ? "La descripción no puede tener más de 512 caracteres" : null,
    },
  });

  const expirationOptions = [
    { value: "never", label: "Nunca" },
    { value: "5-minutes", label: "5 minutos" },
    { value: "10-minutes", label: "10 minutos" },
    { value: "1-hour", label: "1 hora" },
    { value: "1-day", label: "1 día" },
    { value: "3-days", label: "3 días" },
    { value: "7-days", label: "7 días" },
    { value: "30-days", label: "30 días" },
    { value: "custom", label: "Personalizado" },
  ];

  const [selectedExpiration, setSelectedExpiration] = useState("custom");
  const [showCustomDate, setShowCustomDate] = useState(true);

  const handleExpirationChange = (value: string) => {
    setSelectedExpiration(value);
    setShowCustomDate(value === "custom");
    
    if (value !== "custom" && value !== "never") {
      const now = moment();
      let futureDate;
      
      switch (value) {
        case "5-minutes":
          futureDate = now.add(5, "minutes");
          break;
        case "10-minutes":
          futureDate = now.add(10, "minutes");
          break;
        case "1-hour":
          futureDate = now.add(1, "hour");
          break;
        case "1-day":
          futureDate = now.add(1, "day");
          break;
        case "3-days":
          futureDate = now.add(3, "days");
          break;
        case "7-days":
          futureDate = now.add(7, "days");
          break;
        case "30-days":
          futureDate = now.add(30, "days");
          break;
      }
      
      form.setFieldValue("expiration", futureDate?.toDate() || null);
    } else if (value === "never") {
      form.setFieldValue("expiration", null);
    }
  };

  const handleSubmit = async (values: typeof form.values) => {
    setIsLoading(true);
    
    try {
      const updateData: any = {};
      
      // Only include fields that have values or have been explicitly changed
      if (values.name && values.name.trim() !== "") {
        updateData.name = values.name.trim();
      }
      
      if (values.description !== undefined) {
        updateData.description = values.description;
      }
      
      // Always include expiration
      updateData.expiration = values.expiration ? values.expiration.toISOString() : "never";
      
      // Include password only if it's being set
      if (values.hasPassword && values.password && values.password.trim() !== "") {
        updateData.security = {
          password: values.password.trim()
        };
      }

      await shareService.update(share.id, updateData);
      
      toast.success("Share actualizado correctamente");
      onShareUpdated();
      onClose();
      
    } catch (error) {
      console.error("Error al actualizar share:", error);
      toast.error("Error al actualizar el share");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Stack spacing="md">
        <TextInput
          label="Nombre del Share"
          placeholder="Nombre descriptivo"
          {...form.getInputProps("name")}
        />

        <Textarea
          label="Descripción"
          placeholder="Descripción opcional"
          autosize
          minRows={2}
          maxRows={4}
          {...form.getInputProps("description")}
        />

        <Box>
          <Text size="sm" weight={500} mb="xs">
            Expiración
          </Text>
          <Select
            data={expirationOptions}
            value={selectedExpiration}
            onChange={handleExpirationChange}
            mb={showCustomDate ? "sm" : 0}
          />
          {showCustomDate && (
            <DateTimePicker
              label="Fecha y hora de expiración"
              placeholder="Selecciona fecha y hora"
              {...form.getInputProps("expiration")}
              minDate={new Date()}
              onPointerEnterCapture={undefined}
              onPointerLeaveCapture={undefined}
            />
          )}
        </Box>

        <Box>
          <Switch
            label="Proteger con contraseña"
            checked={form.values.hasPassword}
            onChange={(event) => form.setFieldValue("hasPassword", event.currentTarget.checked)}
            mb={form.values.hasPassword ? "sm" : 0}
          />
          {form.values.hasPassword && (
            <PasswordInput
              label="Nueva contraseña (opcional)"
              placeholder="Dejar vacío para mantener la actual"
              {...form.getInputProps("password")}
            />
          )}
        </Box>

        <Group position="right" mt="md">
          <Button 
            variant="subtle" 
            onClick={onClose}
            disabled={isLoading}
          >
            Cancelar
          </Button>
          <Button 
            type="submit" 
            loading={isLoading}
          >
            Guardar Cambios
          </Button>
        </Group>
      </Stack>
    </form>
  );
};

const showShareEditModal = (
  modals: ModalsContextProps,
  share: MyShare,
  onShareUpdated: () => void,
) => {
  return modals.openModal({
    title: "Editar Share",
    size: "md",
    children: (
      <ShareEditModal
        share={share}
        onShareUpdated={onShareUpdated}
        onClose={() => modals.closeAll()}
      />
    ),
  });
};

export default showShareEditModal;