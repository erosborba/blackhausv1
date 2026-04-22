import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

export default function InboxPage() {
  return (
    <main className="pane inbox-empty">
      <EmptyState
        title="Escolha uma conversa"
        hint="Use ⌘K pra buscar por nome ou telefone."
      />
    </main>
  );
}
