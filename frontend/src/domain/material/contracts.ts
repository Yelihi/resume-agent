// Domain value contracts; infrastructure adapters must satisfy these types.


export type MaterialType = "company" | "jobPosting";

export type ReferenceMaterial = {
            /** Sourceid */
            sourceId: string;
            materialType: MaterialType;
            /**
             * Inputtype
             * @enum {string}
             */
            inputType: "text" | "document" | "url";
            /** Content */
            content?: string | null;
            /** Url */
            url?: string | null;
        };

export type MaterialSummary = {
            /** Sourceid */
            sourceId: string;
            /** Summary */
            summary: string;
        };
