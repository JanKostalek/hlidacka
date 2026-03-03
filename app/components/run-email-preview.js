"use client";

const URL_RE = /(https?:\/\/[^\s]+)/g;
const IS_URL_RE = /^https?:\/\/[^\s]+$/;

function openPopup(url) {
  const w = 1100;
  const h = 760;
  const left = Math.max(0, Math.floor((window.screen.width - w) / 2));
  const top = Math.max(0, Math.floor((window.screen.height - h) / 2));
  window.open(
    url,
    "_blank",
    `popup=yes,width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`
  );
}

export default function RunEmailPreview({ text }) {
  const lines = String(text || "").split("\n");

  return (
    <div className="emailPreview">
      {lines.map((line, idx) => {
        const parts = line.split(URL_RE);
        return (
          <div key={idx}>
            {parts.map((part, pIdx) =>
              IS_URL_RE.test(part) ? (
                <a
                  key={pIdx}
                  href={part}
                  onClick={(e) => {
                    e.preventDefault();
                    openPopup(part);
                  }}
                >
                  {part}
                </a>
              ) : (
                <span key={pIdx}>{part}</span>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
