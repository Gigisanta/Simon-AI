import { ImageResponse } from "next/og";

export const socialImageSize = { width: 1200, height: 630 };
export const socialImageContentType = "image/png";

export function createSocialImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          background: "#f8f3e8",
          color: "#393529",
          padding: "72px 78px",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 420,
            height: 420,
            borderRadius: 999,
            right: -95,
            top: -145,
            background: "#d9eede",
          }}
        />
        <div
          style={{
            position: "absolute",
            width: 280,
            height: 280,
            borderRadius: 999,
            left: -105,
            bottom: -125,
            background: "#fbe7d8",
          }}
        />

        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "72%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 74,
                height: 74,
                borderRadius: 999,
                background: "#7fa184",
                color: "white",
                fontSize: 42,
                fontWeight: 800,
              }}
            >
              S
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 38, fontWeight: 800 }}>Simón</span>
              <span style={{ fontSize: 19, color: "#6d6958", fontWeight: 600 }}>siempre acá para vos</span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div style={{ fontSize: 61, lineHeight: 1.08, fontWeight: 800, letterSpacing: -2 }}>
              Un lugar que te entiende
            </div>
            <div style={{ fontSize: 27, lineHeight: 1.35, color: "#6d6958", fontWeight: 600 }}>
              Hablá, aprendé y avanzá paso a paso.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 18, color: "#4a6a50", fontWeight: 700 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: "#5a7f61" }} />
            simon.maat.work
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            right: 92,
            bottom: 76,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 238,
            height: 238,
            borderRadius: 70,
            background: "#7fa184",
            boxShadow: "0 24px 55px rgba(57,53,41,.18)",
          }}
        >
          <div style={{ position: "absolute", top: 68, left: 55, width: 22, height: 22, borderRadius: 999, background: "white" }} />
          <div style={{ position: "absolute", top: 68, right: 55, width: 22, height: 22, borderRadius: 999, background: "white" }} />
          <div style={{ position: "absolute", top: 120, width: 82, height: 36, borderBottom: "8px solid white", borderRadius: "0 0 80px 80px" }} />
          <div style={{ position: "absolute", top: -23, width: 56, height: 48, borderRadius: "55px 8px 55px 8px", background: "#5d7f63", transform: "rotate(-20deg)" }} />
        </div>
      </div>
    ),
    socialImageSize,
  );
}
