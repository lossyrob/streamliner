import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { NotificationCardViewModel } from "../notification-view-model";

interface Props {
  card: NotificationCardViewModel;
}

function bytesToDataUrl(bytes: number[]): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

export function NotificationCard({ card }: Props) {
  const [badgeUrl, setBadgeUrl] = useState<string | null>(null);
  const { notification } = card;

  useEffect(() => {
    let cancelled = false;
    invoke<number[]>("notification_badge", {
      colorHex: card.badge.colorHex,
      monogram: card.badge.monogram,
      eventKind: card.badge.eventKind,
      sizePx: 56,
    })
      .then((bytes) => {
        if (!cancelled) setBadgeUrl(bytesToDataUrl(bytes));
      })
      .catch(() => {
        if (!cancelled) setBadgeUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [card.badge.colorHex, card.badge.eventKind, card.badge.monogram]);

  const openNotification = () => {
    if (!notification.link) return;
    invoke("open_link", { link: notification.link }).catch(console.error);
  };

  return (
    <article
      className={`notification-card severity-${notification.severity}`}
      style={{ borderLeftColor: card.accentColor }}
    >
      <button
        className="notification-card-button"
        disabled={!card.clickable}
        onClick={openNotification}
        type="button"
      >
        <div className="badge-shell" aria-hidden="true">
          {badgeUrl ? (
            <img src={badgeUrl} alt="" />
          ) : (
            <span style={{ backgroundColor: card.accentColor }}>{card.badge.monogram}</span>
          )}
        </div>
        <div className="notification-content">
          <div className="notification-meta">
            <span className="event-kind">{card.eventLabel}</span>
            <span className="severity">{card.severityLabel}</span>
            <time dateTime={notification.createdAt}>{card.relativeTime}</time>
          </div>
          <h2>{notification.title}</h2>
          <p>{notification.body}</p>
          <div className="notification-footer">
            {notification.workstreamShortName ?? notification.projectKey ?? "Streamliner"}
            {notification.link ? <span>Open</span> : <span>No link</span>}
          </div>
        </div>
      </button>
    </article>
  );
}
