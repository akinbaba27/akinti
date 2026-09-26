"use client";

/**
 * Settings hub → "Delete account" (SCREENS.md §11, DESIGN.md §11.2): an ink
 * text key, no button, no red pill (§12). The confirmation is a Sheet that
 * spells out what is lost and requires retyping the account's own handle —
 * never a plain "are you sure" dialog.
 */

import { useTranslations } from "next-intl";
import { useState } from "react";

import { deleteAccount } from "@/app/(app)/settings/actions";
import { Button, Input, Sheet } from "@/components/ui";
import { routes } from "@/config/routes";

export interface DeleteAccountSheetProps {
  /** The signed-in account's own handle (no `@`), used to gate the confirm key. */
  username: string;
}

export function DeleteAccountSheet({ username }: DeleteAccountSheetProps) {
  const t = useTranslations("DeleteAccountSheet");
  const tCommon = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const [confirmHandle, setConfirmHandle] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const close = () => {
    if (deleting) return;
    setOpen(false);
    setConfirmHandle("");
    setFieldError(null);
    setFormError(null);
  };

  const handleDelete = () => {
    setDeleting(true);
    setFieldError(null);
    setFormError(null);
    void deleteAccount({ confirmHandle })
      .then((result) => {
        if (!result.ok) {
          setDeleting(false);
          setFieldError(result.fieldErrors?.confirmHandle ?? null);
          setFormError(result.formError ?? null);
          return;
        }
        // Mirrors `UserMenu`'s sign-out navigation: a hard navigation, not a
        // client-side transition, so nothing keeps rendering signed in on the
        // now-deleted account.
        window.location.assign(result.redirectTo ?? routes.login());
      })
      .catch(() => {
        // A rejected Server Action (network failure, not a `{ ok: false }`
        // response) used to leave `deleting` true forever and the sheet
        // stuck open with no way to dismiss it (review3 finding 16 /
        // review2 finding 15) — the one screen where being stuck is most
        // alarming.
        setDeleting(false);
        setFormError(tCommon("somethingWentWrong"));
      });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="akinti-press akinti-tap type-body inline-flex items-center text-ink underline decoration-hairline-strong decoration-1 underline-offset-[3px] hover:decoration-ink"
      >
        {t("deleteAccount")}
      </button>

      <Sheet
        open={open}
        onClose={close}
        title={t("deleteAccount")}
        description={t("description")}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close} disabled={deleting}>
              {t("keepAccount")}
            </Button>
            <Button
              variant="ghost"
              onClick={handleDelete}
              loading={deleting}
              disabled={confirmHandle.trim().toLowerCase() !== username.toLowerCase()}
            >
              {t("deleteMyAccount")}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <Input
            id="delete-account-confirm-handle"
            label={t("confirmLabel", { username })}
            value={confirmHandle}
            onChange={(event) => setConfirmHandle(event.target.value)}
            leadingIcon={<span aria-hidden="true">@</span>}
            error={fieldError}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {formError ? (
            <p role="alert" className="type-body-sm text-ink">
              {formError}
            </p>
          ) : null}
        </div>
      </Sheet>
    </>
  );
}
