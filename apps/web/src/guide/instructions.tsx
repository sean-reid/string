import type { ReactNode } from "react";
import {
  AnchorArt,
  BoardArt,
  FinishArt,
  NailsArt,
  TroubleArt,
  WeaveArt,
  WrapArt,
} from "./step-illustrations";

interface Section {
  title: string;
  art: ReactNode;
  steps: string[];
}

const SECTIONS: Section[] = [
  {
    title: "Prepare the board",
    art: <BoardArt />,
    steps: [
      "Start with a birch plywood disc at the diameter you picked. Half-inch thickness is the minimum; thinner and nails will poke through under tension.",
      "Sand the face with 220 grit so paint or finish grips.",
      "Finish the face cream. Two thin coats of matte chalk paint in a warm off-white, fully dry between, gives the dark thread the contrast it needs. Satin clear over natural birch works too if you prefer the wood grain.",
    ],
  },
  {
    title: "Lay out the nails",
    art: <NailsArt />,
    steps: [
      "Mark the exact center of the disc.",
      "Tape down a paper circle equal to the disc diameter with the center marks aligned. Every tenth nail position should read boldly so you can orient quickly.",
      "Drive every tenth nail first as registration points, then fill the rest.",
      "For consistent height, make a depth jig: an 11 mm slice of hard rubber (urethane puck, neoprene, or a sliced skateboard wheel) with a hole drilled to fit the nail shank loosely and a thin slot cut from the edge to the hole. Slip the jig over each nail, hammer until the head meets the rubber, then flex the slot open and pop it off. A held-against 11 mm scrap of wood works as a fallback.",
      "Tear the paper away between the nails. Small fragments left under the heads are fine.",
    ],
  },
  {
    title: "Anchor the thread",
    art: <AnchorArt />,
    steps: [
      "Tie a double loop around nail 0 at 12 o’clock. A drop of PVA or super glue on the back of the nail locks it.",
      "Leave a 3 cm tail. Trim later.",
      "Work the thread off a loose spool in a bowl. A ball on the floor tangles within minutes.",
    ],
  },
  {
    title: "Work the sequence",
    art: <WeaveArt />,
    steps: [
      "Each row of the sequence list says the next nail to visit. Pull the thread from the current nail to the next one.",
      "Pass the thread around the far side of that nail so the nail sits between the thread and the previous line, then head toward the following nail. The next tensioned line pins the wrap in place.",
      "Tension: firm enough that a flick of the line leaves it perfectly straight. Not so tight the nail leans.",
      "Press Space to play or pause auto-advance. Arrow keys step one nail at a time. Progress persists in this browser.",
      "Out of thread: tie a surgeon’s knot onto the new length on the back side of the nearest nail and glue it. The knot hides behind the nail.",
    ],
  },
  {
    title: "Alternate the wrap side",
    art: <WrapArt />,
    steps: [
      "Alternate which side of each nail the thread wraps around: left of one nail, right of the next, back to left on the one after. The pattern never breaks for the duration of the build.",
      "The reason is purely aesthetic. Alternating wraps keep the finished face looking even at every nail; two same-side wraps in a row make the thread pile visibly on one side and read noisy up close.",
      "Quick self-check: after each new line, glance back at the last few nails. If left-right-left-right is holding, keep going. If you catch two of the same in a row, back up to the last good nail and redo from there.",
    ],
  },
  {
    title: "Finish",
    art: <FinishArt />,
    steps: [
      "Wrap the last nail three or four times, square knot on the back, glue, trim to 2 mm.",
      "Mount a sawtooth hanger or two D-rings on the back for wall hanging.",
      "Optional: a single light coat of matte clear spray from 30 cm fixes thread against dust without sheen.",
    ],
  },
  {
    title: "If something goes sideways",
    art: <TroubleArt />,
    steps: [
      "Skipped a nail? Back up to the error and redo from there. One skip offsets every line after.",
      "Tangles: walk slack back to the spool gently. A fresh splice is cheaper than fighting a knot.",
      "Nail pulled out? Pre-drill a 1 mm pilot hole at any subsequent knots in the wood.",
      "The face reads better at arm’s length than at the workbench. Step back to check.",
    ],
  },
];

export function Instructions() {
  return (
    <ol className="flex flex-col divide-y divide-line">
      {SECTIONS.map((section, sectionIndex) => (
        <li
          key={section.title}
          className="flex flex-col gap-6 py-12 first:pt-0 last:pb-0 sm:flex-row sm:gap-10"
        >
          <div className="flex shrink-0 items-start sm:w-[180px]">
            {section.art}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <header className="flex items-baseline gap-3">
              <span className="font-mono text-[11px] leading-none tabular-nums text-muted">
                {String(sectionIndex + 1).padStart(2, "0")}
              </span>
              <h3 className="font-display text-xl leading-tight tracking-tight text-ink">
                {section.title}
              </h3>
            </header>
            <ol className="flex list-decimal flex-col gap-4 pl-5 text-sm leading-relaxed text-ink marker:text-muted marker:font-mono">
              {section.steps.map((step, i) => (
                <li key={i} className="pl-1.5">
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </li>
      ))}
    </ol>
  );
}
