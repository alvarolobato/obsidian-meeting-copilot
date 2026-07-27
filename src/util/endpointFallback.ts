import {
	inferSttApiType,
	type SttApiType,
} from "../transcribe/sttModel";

/** Primary or fallback OpenAI-compatible endpoint credentials + model ids. */
export interface EndpointConfig {
	baseUrl: string;
	apiKey: string;
	/** Wire model for /audio/transcriptions. */
	sttModel: string;
	/** Engine family for the STT wire model. */
	sttApiType: SttApiType;
	/** Wire model for /chat/completions. */
	enrichModel: string;
}

export interface EndpointSettingsSlice {
	apiBaseUrl: string;
	apiKey: string;
	sttModel: string;
	sttApiType: SttApiType;
	enrichModel: string;
	fallbackApiBaseUrl: string;
	fallbackApiKey: string;
	/** Empty → reuse primary `sttModel`. */
	fallbackSttModel: string;
	/** Empty → reuse primary `enrichModel`. */
	fallbackEnrichModel: string;
}

/** True when the user configured a usable fallback base URL (+ key). */
export function isFallbackEndpointConfigured(
	s: EndpointSettingsSlice
): boolean {
	return s.fallbackApiBaseUrl.trim().length > 0 && s.fallbackApiKey.trim().length > 0;
}

/** Primary shared endpoint from settings. */
export function primaryEndpoint(s: EndpointSettingsSlice): EndpointConfig {
	return {
		baseUrl: s.apiBaseUrl.trim(),
		apiKey: s.apiKey.trim(),
		sttModel: s.sttModel.trim(),
		sttApiType: s.sttApiType,
		enrichModel: s.enrichModel.trim(),
	};
}

/**
 * Fallback endpoint when configured; otherwise `null`.
 * Missing fallback model fields inherit the primary model ids.
 */
export function fallbackEndpoint(
	s: EndpointSettingsSlice
): EndpointConfig | null {
	if (!isFallbackEndpointConfigured(s)) return null;
	const sttModel =
		s.fallbackSttModel.trim() || s.sttModel.trim();
	const enrichModel =
		s.fallbackEnrichModel.trim() || s.enrichModel.trim();
	return {
		baseUrl: s.fallbackApiBaseUrl.trim(),
		apiKey: s.fallbackApiKey.trim(),
		sttModel,
		// Infer from the fallback wire name — primary's engine family may not
		// match a differently named gateway model.
		sttApiType: inferSttApiType(sttModel),
		enrichModel,
	};
}
