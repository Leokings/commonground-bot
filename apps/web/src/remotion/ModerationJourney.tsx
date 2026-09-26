import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const stages = [
  {
    eyebrow: "01 · MEMBER REPORT",
    title: "One message is flagged",
    body: "A member replies with @CommonGround report. Everything else stays untouched.",
    icon: "↗",
    color: "#ff6d5a",
  },
  {
    eyebrow: "02 · RULE ROUTING",
    title: "The right rule is selected",
    body: "Fast checks handle obvious cases. Contextual language moves to GenLayer.",
    icon: "⌁",
    color: "#54d6a5",
  },
  {
    eyebrow: "03 · GENLAYER",
    title: "Validators read the context",
    body: "The reported message, its reply, and useful nearby conversation are reviewed together.",
    icon: "✦",
    color: "#ffd166",
  },
  {
    eyebrow: "04 · FINALIZED",
    title: "The action follows the rule",
    body: "Discord receives the final decision and posts an auditable result in the same server.",
    icon: "✓",
    color: "#8f7cff",
  },
] as const;

function Stage({ index }: { index: number }) {
  const frame = useCurrentFrame();
  const stage = stages[index]!;
  const opacity = interpolate(frame, [0, 10, 48, 59], [0, 1, 1, 0], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rise = interpolate(frame, [0, 16], [42, 0], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scale = interpolate(frame, [0, 18], [0.78, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        display: "flex",
        flexDirection: "row",
        gap: 48,
        justifyContent: "center",
        opacity,
        padding: "90px 76px 66px",
      }}
    >
      <div
        style={{
          alignItems: "center",
          backgroundColor: stage.color,
          border: "5px solid #101b2d",
          borderRadius: 40,
          boxShadow: "12px 12px 0 #101b2d",
          color: "#101b2d",
          display: "flex",
          fontSize: 108,
          fontWeight: 900,
          height: 210,
          justifyContent: "center",
          scale,
          width: 210,
        }}
      >
        {stage.icon}
      </div>
      <div style={{ maxWidth: 540, translate: `0 ${rise}px` }}>
        <div
          style={{
            color: stage.color,
            fontSize: 24,
            fontWeight: 800,
            letterSpacing: 2.5,
            marginBottom: 16,
          }}
        >
          {stage.eyebrow}
        </div>
        <div
          style={{
            color: "#fff7e8",
            fontSize: 58,
            fontWeight: 850,
            letterSpacing: -2.8,
            lineHeight: 1.02,
          }}
        >
          {stage.title}
        </div>
        <div
          style={{
            color: "#c7c8d8",
            fontSize: 26,
            lineHeight: 1.38,
            marginTop: 22,
          }}
        >
          {stage.body}
        </div>
      </div>
    </AbsoluteFill>
  );
}

function Timeline() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = interpolate(frame, [0, durationInFrames - 1], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        backgroundColor: "#33405a",
        bottom: 38,
        height: 8,
        left: 76,
        overflow: "hidden",
        position: "absolute",
        right: 76,
      }}
    >
      <div
        style={{
          backgroundColor: "#8f7cff",
          height: "100%",
          width: `${progress}%`,
        }}
      />
    </div>
  );
}

export function ModerationJourney() {
  const frame = useCurrentFrame();
  const dots = Array.from({ length: 12 }, (_, index) => ({
    left: 30 + ((index * 83) % 900),
    top: 24 + ((index * 47) % 470),
    size: 5 + (index % 3) * 3,
  }));

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#101b2d",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        overflow: "hidden",
      }}
    >
      {dots.map((dot, index) => (
        <div
          key={`${dot.left}-${dot.top}`}
          style={{
            backgroundColor: index % 2 ? "#6c4bf4" : "#54d6a5",
            borderRadius: "50%",
            height: dot.size,
            left: dot.left,
            opacity: 0.22,
            position: "absolute",
            top: dot.top,
            translate: `0 ${Math.sin(frame / 18 + index) * 10}px`,
            width: dot.size,
          }}
        />
      ))}
      {stages.map((stage, index) => (
        <Sequence
          key={stage.eyebrow}
          from={index * 60}
          durationInFrames={60}
          premountFor={30}
        >
          <Stage index={index} />
        </Sequence>
      ))}
      <Timeline />
    </AbsoluteFill>
  );
}
