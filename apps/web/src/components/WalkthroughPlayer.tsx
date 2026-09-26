import { Player } from "@remotion/player";

import { ModerationJourney } from "../remotion/ModerationJourney";

export default function WalkthroughPlayer() {
  return (
    <Player
      component={ModerationJourney}
      durationInFrames={240}
      compositionWidth={960}
      compositionHeight={540}
      fps={30}
      autoPlay
      loop
      controls
      style={{ width: "100%" }}
    />
  );
}
