import { useCallback, useState } from 'react';

/**
 * Card moving that works the same on a desktop mouse and on the tablet the
 * coordinator actually uses. Desktop gets native HTML5 drag and drop; touch
 * screens get "tap the card, then tap where it should go", because HTML5
 * drag events never fire on touch.
 */
export function useCardMover(onMove: (cardId: string, targetId: string) => void | Promise<void>) {
  const [held, setHeld] = useState<string | null>(null);

  const release = useCallback(() => setHeld(null), []);

  const dragProps = useCallback(
    (cardId: string) => ({
      draggable: true,
      'data-held': held === cardId ? 'true' : undefined,
      onDragStart: (event: React.DragEvent) => {
        event.dataTransfer.setData('text/plain', cardId);
        event.dataTransfer.effectAllowed = 'move';
        setHeld(cardId);
      },
      onDragEnd: () => setHeld(null),
      onClick: () => setHeld((current) => (current === cardId ? null : cardId)),
    }),
    [held],
  );

  const dropProps = useCallback(
    (targetId: string) => ({
      onDragOver: (event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        const cardId = event.dataTransfer.getData('text/plain') || held;
        setHeld(null);
        if (cardId) void onMove(cardId, targetId);
      },
      onClick: () => {
        if (!held) return;
        const cardId = held;
        setHeld(null);
        void onMove(cardId, targetId);
      },
    }),
    [held, onMove],
  );

  return { held, release, dragProps, dropProps };
}
