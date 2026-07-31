import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildNotificationFeedViewModel, mergeNotifications } from "../notification-view-model";
import type { NotificationRecord, NotificationSnapshotPayload } from "../types/notification";
import { NOTIFICATION_SSE_EVENTS } from "../types/notification";

export interface UseNotificationEventsResult {
  notifications: NotificationRecord[];
  cards: ReturnType<typeof buildNotificationFeedViewModel>;
  loading: boolean;
  error: string | null;
}

export function useNotificationEvents(): UseNotificationEventsResult {
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!loadedRef.current) {
      loadedRef.current = true;
      invoke<NotificationRecord[]>("list_notifications", { limit: 100 })
        .then((backlog) => {
          setNotifications((current) => mergeNotifications(current, backlog));
          setError(null);
        })
        .catch((err: unknown) => setError(String(err)))
        .finally(() => setLoading(false));
    }

    const snapshotUnlisten = listen<NotificationSnapshotPayload>(
      NOTIFICATION_SSE_EVENTS.snapshot,
      (event) => {
        setNotifications((current) =>
          mergeNotifications(current, event.payload.notifications),
        );
      },
    );

    const createdUnlisten = listen<NotificationRecord>(
      NOTIFICATION_SSE_EVENTS.created,
      (event) => {
        setNotifications((current) => mergeNotifications(current, [event.payload]));
      },
    );

    return () => {
      snapshotUnlisten.then((unlisten) => unlisten());
      createdUnlisten.then((unlisten) => unlisten());
    };
  }, []);

  const cards = useMemo(
    () => buildNotificationFeedViewModel(notifications),
    [notifications],
  );

  return { notifications, cards, loading, error };
}
