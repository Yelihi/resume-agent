// Domain value contracts; infrastructure adapters must satisfy these types.


export type ModuleErrorDTO = {
            /** Modulekey */
            moduleKey: string;
            /** Inputsourceid */
            inputSourceId: string | null;
            /** Errorcode */
            errorCode: string;
            /** Usermessage */
            userMessage: string;
            /** Canretry */
            canRetry: boolean;
        };
