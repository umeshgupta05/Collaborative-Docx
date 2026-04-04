
import React, { memo } from "react";
import { CursorPosition } from "@/utils/cursor-utils";

interface RemoteCursorsProps {
  cursors: CursorPosition[];
}

// Use memo to prevent unnecessary re-renders
const RemoteCursor = memo(({ cursor }: { cursor: CursorPosition }) => {
  return (
    <div
      className="absolute pointer-events-none will-change-transform"
      style={{
        top: cursor.position.top,
        left: cursor.position.left,
        transform: "translate(-50%, -50%)",
        zIndex: 50,
        transition: "top 0.08s ease, left 0.08s ease", // Faster cursor transitions
      }}
    >
      <div
        className="absolute px-2 py-1 rounded-md text-[11px] font-medium text-white shadow-md border border-white/30"
        style={{
          left: "50%",
          top: 0,
          transform: "translate(-50%, calc(-100% - 10px))",
          backgroundColor: cursor.color,
          whiteSpace: "nowrap",
          maxWidth: "160px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          opacity: 0.96,
          lineHeight: 1,
        }}
      >
        {cursor.username}
      </div>
      <div
        className="w-3 h-3 rounded-full ring-2 ring-background"
        style={{ backgroundColor: cursor.color }}
      />
    </div>
  );
});

RemoteCursor.displayName = 'RemoteCursor';

const RemoteCursors: React.FC<RemoteCursorsProps> = ({ cursors }) => {
  // Don't render more than a reasonable number of cursors to maintain performance
  const visibleCursors = cursors.slice(0, 10);

  return (
    <>
      {visibleCursors.map((cursor) => (
        <RemoteCursor key={cursor.userId} cursor={cursor} />
      ))}
    </>
  );
};

export default memo(RemoteCursors);
