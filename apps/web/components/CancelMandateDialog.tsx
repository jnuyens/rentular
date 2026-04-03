"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

interface CancelMandateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mandateId: string;
  tenantName: string;
  onSuccess?: () => void;
}

export function CancelMandateDialog({
  open,
  onOpenChange,
  mandateId,
  tenantName,
  onSuccess,
}: CancelMandateDialogProps) {
  const t = useTranslations("mandates");
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  const [cancelling, setCancelling] = useState(false);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/gocardless/mandates/${mandateId}/cancel`,
        {
          method: "POST",
          credentials: "include",
        }
      );

      if (res.ok) {
        toast.success(t("mandateCancelled"));
        onOpenChange(false);
        onSuccess?.();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to cancel mandate");
      }
    } catch {
      toast.error("Failed to cancel mandate");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("cancelTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("cancelDescription", { tenantName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={cancelling}>
            {t("keepMandate")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleCancel}
            disabled={cancelling}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {cancelling ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {t("cancelMandate")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
