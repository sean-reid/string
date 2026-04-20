import { CanvasStage } from "@/canvas/stage";
import { ParameterRail } from "@/app/rail";

export function HomePage() {
  return (
    <section
      aria-label="String-art composer"
      className="grid flex-1 grid-cols-1 lg:grid-cols-[1fr_320px]"
    >
      <CanvasStage />
      <ParameterRail />
    </section>
  );
}
