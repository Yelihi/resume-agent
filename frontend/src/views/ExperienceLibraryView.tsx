import { ExperienceLibrary } from "../features/experiences/ExperienceLibrary";
import { useApplicationView } from "./context";
export function ExperienceLibraryView() { return <ExperienceLibrary application={useApplicationView().application} />; }
