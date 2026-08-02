/** Cover art box: real thumbnail image with the typographic gradient treatment
 *  as the loading / error fallback. A thin progress bar is pinned to the bottom. */
import { useState } from "react";
import * as api from "../lib/api";
import { coverTreatment } from "../lib/cover";
import { kindLabel, metaLine, percentRead } from "../lib/format";

type Variant = "grid" | "continue";

export default function CoverArt({
  record,
  className,
  variant,
  width = 480,
}: {
  record: api.WebComicRecord;
  className: string;
  variant: Variant;
  width?: number;
}) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const treat = coverTreatment(record.title);
  const pct = percentRead(record);
  const showFallback = status !== "loaded";

  return (
    <div
      className={`${className}${status === "loading" ? " cover-loading" : ""}`}
      style={{ background: treat.gradient }}
    >
      {status !== "error" && (
        <img
          className="cover-img"
          src={api.coverUrl(record, width)}
          alt=""
          loading="lazy"
          style={{ opacity: status === "loaded" ? 1 : 0, transition: "opacity .25s ease" }}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
        />
      )}

      {/* Keep typographic treatment while loading or after error — never blank. */}
      {showFallback &&
        (variant === "grid" ? (
          <div className="cover-inner" style={{ color: treat.ink }}>
            <div>
              <div className="cover-kind">{kindLabel(record)}</div>
              <div className="cover-title">{record.title}</div>
            </div>
            <div className="cover-author">{metaLine(record)}</div>
          </div>
        ) : (
          <div className="cover-inner" style={{ color: treat.ink }}>
            <div className="cover-title" style={{ fontSize: 15, marginTop: 0 }}>
              {record.title}
            </div>
            <div className="cover-author">{metaLine(record)}</div>
          </div>
        ))}

      <div className="cover-progress">
        <div
          style={{
            width: `${pct}%`,
            background: status === "loaded" ? "var(--accent)" : treat.ink,
            opacity: status === "loaded" ? 0.9 : 0.85,
          }}
        />
      </div>
    </div>
  );
}
