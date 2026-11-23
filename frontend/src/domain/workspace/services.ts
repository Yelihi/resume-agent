import type { ResumeGateway } from "../resume/ports";
import type { MaterialGateway } from "../material/ports";
import type { ReviewGateway } from "../review/ports";
import type { ExperienceGateway } from "../experience/entities";
import type { AccountGateway } from "../shared/account";
import type { PortfolioGateway } from "../review/portfolio";
export type ApplicationServices = ResumeGateway & MaterialGateway & ReviewGateway & ExperienceGateway & AccountGateway & Partial<PortfolioGateway>;
export type { ConfirmAction } from "../shared/interaction";
