import type { NotificationCardViewModel } from "../notification-view-model";
import { NotificationCard } from "./NotificationCard";

interface Props {
  cards: NotificationCardViewModel[];
  loading: boolean;
  error: string | null;
}

export function NotificationFeed({ cards, loading, error }: Props) {
  if (loading && cards.length === 0) {
    return <div className="empty-state">Loading Streamliner notifications...</div>;
  }

  if (error && cards.length === 0) {
    return (
      <div className="empty-state error-state">
        <strong>Streamliner API unavailable</strong>
        <span>{error}</span>
      </div>
    );
  }

  if (cards.length === 0) {
    return <div className="empty-state">No notifications yet.</div>;
  }

  return (
    <div className="feed-stack">
      {error ? <div className="inline-error">Backlog refresh failed: {error}</div> : null}
      {cards.map((card) => (
        <NotificationCard card={card} key={card.notification.id} />
      ))}
    </div>
  );
}
