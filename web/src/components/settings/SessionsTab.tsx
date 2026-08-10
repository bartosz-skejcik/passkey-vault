"use client";

// Sessions & devices tab content (AUTH-07, 03-UI-SPEC.md "Sessions &
// devices" section) — list + current-device detection + per-row revoke +
// bulk "Wyloguj pozostałe". Per binding resolution #6 (03-UI-SPEC.md's
// "Resolutions" section), BOTH per-session revoke and the bulk action get
// a confirm modal (fat-finger/fat-key prevention) — this deviates from the
// original UI-SPEC's "no confirmation, immediate action" design for
// per-row revoke and the original "inline confirm block" design for the
// bulk action; both now reuse the shared ConfirmDialog.
import { useEffect, useState } from "react";
import { HelpCircle, LogOut, Monitor, Smartphone, Tablet } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { interpolate } from "@/lib/i18n/dictionary";
import { formatRelativeTime } from "@/lib/format/relativeTime";
import { detectDeviceType, type DeviceType } from "@/lib/format/deviceType";
import { listSessions, revokeSession, type SessionRow } from "@/lib/sessions/api";
import ConfirmDialog from "./ConfirmDialog";

const DEVICE_ICON: Record<DeviceType, typeof Monitor> = {
  desktop: Monitor,
  phone: Smartphone,
  tablet: Tablet,
  unknown: HelpCircle,
};

export default function SessionsTab() {
  const { t, locale } = useLocale();
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [revokeError, setRevokeError] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<SessionRow | null>(null);
  const [showRevokeOthers, setShowRevokeOthers] = useState(false);

  async function refetch() {
    try {
      const data = await listSessions();
      setRows(data);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }

  useEffect(() => {
    void refetch();
  }, []);

  async function handleRevoke(row: SessionRow) {
    setRevokeError(false);
    try {
      await revokeSession(row.id);
      setRows((prev) => prev?.filter((r) => r.id !== row.id) ?? prev);
      setRevokeTarget(null);
    } catch {
      setRevokeError(true);
      setRevokeTarget(null);
    }
  }

  async function handleRevokeOthers() {
    const others = (rows ?? []).filter((r) => !r.current);
    setRevokeError(false);
    try {
      await Promise.all(others.map((r) => revokeSession(r.id)));
      setShowRevokeOthers(false);
      await refetch();
    } catch {
      setRevokeError(true);
      setShowRevokeOthers(false);
    }
  }

  const hasOtherSessions = (rows ?? []).some((r) => !r.current);

  return (
    <div className="flex flex-col gap-4">
      {hasOtherSessions ? (
        <button
          type="button"
          data-testid="sessions-revoke-others-trigger"
          className="btn btn-ghost btn-sm self-start"
          onClick={() => setShowRevokeOthers(true)}
        >
          <LogOut size={16} aria-hidden="true" />
          {t("sessions.revokeOthers")}
        </button>
      ) : null}

      {loadError ? (
        <p data-testid="sessions-load-error" className="text-sm text-error">
          {t("sessions.loadFailed")}
        </p>
      ) : null}

      {revokeError ? (
        <p data-testid="sessions-revoke-error" className="text-sm text-error">
          {t("sessions.revokeFailed")}
        </p>
      ) : null}

      {rows !== null && rows.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const deviceType = detectDeviceType(row.user_agent);
            const DeviceIcon = DEVICE_ICON[deviceType];
            const signedIn = formatRelativeTime(row.created_at, t, locale);
            const lastActive = formatRelativeTime(row.last_used_at ?? undefined, t, locale);
            return (
              <li
                key={row.id}
                data-testid={`session-row-${row.id}`}
                className="flex min-h-16 items-center gap-3 rounded-box border border-base-300 bg-base-100 px-4 py-3"
              >
                <DeviceIcon size={20} className="shrink-0 text-base-content/60" aria-hidden="true" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-base">{row.user_agent ?? t("sessions.unknownDevice")}</span>
                  <span className="text-sm text-base-content/60">
                    {interpolate(t("sessions.signedInLabel"), { date: signedIn ?? "—" })}
                    {lastActive
                      ? ` · ${interpolate(t("sessions.lastActiveLabel"), { time: lastActive })}`
                      : ""}
                  </span>
                </div>
                {row.current === true ? (
                  <span className="badge badge-ghost shrink-0 text-base-content/70">
                    {t("sessions.currentDevice")}
                  </span>
                ) : (
                  <button
                    type="button"
                    data-testid={`session-revoke-trigger-${row.id}`}
                    aria-label={interpolate(t("aria.revokeSessionLabel"), {
                      device: row.user_agent ?? t("sessions.unknownDevice"),
                    })}
                    className="btn btn-ghost btn-square btn-sm shrink-0"
                    onClick={() => setRevokeTarget(row)}
                  >
                    <LogOut size={16} aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {revokeTarget ? (
        <ConfirmDialog
          title={t("sessions.revokeConfirmTitle")}
          body={t("sessions.revokeConfirmBody")}
          confirmLabel={t("sessions.revokeConfirmButton")}
          onConfirm={() => handleRevoke(revokeTarget)}
          onClose={() => setRevokeTarget(null)}
        />
      ) : null}

      {showRevokeOthers ? (
        <ConfirmDialog
          title={t("sessions.revokeOthersConfirmTitle")}
          body={t("sessions.revokeOthersConfirmBody")}
          confirmLabel={t("sessions.revokeOthersConfirmButton")}
          onConfirm={handleRevokeOthers}
          onClose={() => setShowRevokeOthers(false)}
        />
      ) : null}
    </div>
  );
}
