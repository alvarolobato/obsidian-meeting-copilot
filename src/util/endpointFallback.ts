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

/** True when the user set a fallback base URL (API key is optional). */
export function isFallbackEndpointConfigured(
	s: EndpointSettingsSlice
): boolean {
	return s.fallbackApiBaseUrl.trim().length > 0;
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
	const fallbackStt = s.fallbackSttModel.trim();
	const sttModel = fallbackStt || s.sttModel.trim();
	const enrichModel =
		s.fallbackEnrichModel.trim() || s.enrichModel.trim();
	return {
		baseUrl: s.fallbackApiBaseUrl.trim(),
		apiKey: s.fallbackApiKey.trim(),
		sttModel,
		// Inherit the user's explicit primary engine family when reusing the
		// primary wire model (gateway ids often don't hint "whisper"/"mini").
		// Only infer when the user set a distinct fallback STT model.
		sttApiType: fallbackStt
			? inferSttApiType(fallbackStt)
			: s.sttApiType,
		enrichModel,
	};
}
