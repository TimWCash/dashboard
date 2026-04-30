import { Composition } from "remotion";
import { ConferencePromo } from "./ConferencePromo";
import { TOTAL_FRAMES } from "./constants";

export const Root: React.FC = () => {
  return (
    <Composition
      id="ConferencePromo"
      component={ConferencePromo}
      durationInFrames={TOTAL_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
