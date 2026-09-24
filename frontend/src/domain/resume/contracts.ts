// Domain value contracts; infrastructure adapters must satisfy these types.


export type PageDocument = {
            /** Pages */
            pages: DocumentPage[];
            extraction?: ExtractionReport | null;
        };

export type DocumentPage = {
            /** Pagenumber */
            pageNumber: number;
            /** Blocks */
            blocks: PageBlock[];
        };

export type PageBlock = {
            /** Blockid */
            blockId: string;
            bbox: NormalizedBBox;
            /** Lines */
            lines: PageLine[];
        };

export type NormalizedBBox = {
            /** X */
            x: number;
            /** Y */
            y: number;
            /** Width */
            width: number;
            /** Height */
            height: number;
        };

export type PageLine = {
            /** Lineid */
            lineId: string;
            /** Text */
            text: string;
            bbox: NormalizedBBox;
            /**
             * Textsource
             * @enum {string}
             */
            textSource: "embedded" | "ocr";
            /** Uncertainwords */
            uncertainWords: string[];
        };

export type ExtractionReport = {
            /**
             * Status
             * @enum {string}
             */
            status: "complete" | "recovered" | "needs_review";
            /** Issues */
            issues?: ExtractionIssue[];
            /**
             * Confirmed
             * @default false
             */
            confirmed: boolean;
        };

export type ExtractionIssue = {
            /**
             * Stage
             * @enum {string}
             */
            stage: "assessment" | "recovery";
            /** Code */
            code: string;
            /** Message */
            message: string;
            /** Pagenumber */
            pageNumber?: number | null;
            /** Lineids */
            lineIds?: string[];
            bbox?: NormalizedBBox | null;
            /**
             * Recovered
             * @default false
             */
            recovered: boolean;
        };

export type FlowDocument = {
            /** Text */
            text: string;
            /** Blocks */
            blocks: FlowBlock[];
            extraction?: ExtractionReport | null;
        };

export type FlowBlock = {
            /** Blockid */
            blockId: string;
            /** Lines */
            lines: FlowLine[];
        };

export type FlowLine = {
            /** Lineid */
            lineId: string;
            /** Text */
            text: string;
            /** Startoffset */
            startOffset: number;
            /** Endoffset */
            endOffset: number;
        };

export type ResumeValidationPolicy = {
            maximumFileSizeBytes: FileSizeLimits;
            /** Maximumdirecttextcharacters */
            maximumDirectTextCharacters: number;
        };

export type FileSizeLimits = {
            /** Pdf */
            pdf: number;
            /** Image */
            image: number;
            /** Docx */
            docx: number;
            /** Txt */
            txt: number;
        };
