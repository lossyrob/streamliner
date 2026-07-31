import "./App.css";
import { NotificationFeed } from "./components/NotificationFeed";
import { useNotificationEvents } from "./hooks/useNotificationEvents";

export default function App() {
  const { cards, loading, error } = useNotificationEvents();

  return (
    <main className="app-shell">
      <header className="feed-header">
        <div>
          <p className="eyebrow">Streamliner</p>
          <h1>Notification Feed</h1>
        </div>
        <span className="live-pill">Live SSE</span>
      </header>
      <NotificationFeed cards={cards} loading={loading} error={error} />
    </main>
  );
}
