export class MuapiClient {
    constructor() {
        this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    }

    getKey() {
        const key = localStorage.getItem('google_ai_key');
        if (!key) throw new Error('API Key missing. Please set it in Settings.');
        return key;
    }

    getHeaders() {
        const key = this.getKey();
        return {
            'Content-Type': 'application/json',
            'x-goog-api-key': key
        };
    }

    mapImageModel(id) {
        if (id === 'nano-banana-pro') return 'gemini-3-pro-image-preview';
        if (id === 'nano-banana') return 'gemini-2.5-flash-image';
        if (id === 'gemini-2.5-flash-image') return 'gemini-2.5-flash-image';
        if (id === 'gemini-3-pro-image-preview') return 'gemini-3-pro-image-preview';
        return null;
    }

    mapVideoModel(id) {
        if (id === 'veo-3.1-generate-preview') return 'veo-3.1-generate-preview';
        if (id === 'veo') return 'veo-3.1-generate-preview';
        if (id === 'veo-3' || id === 'veo-3.1') return 'veo-3.1-generate-preview';
        return null;
    }

    resolutionToImageSize(resolution) {
        if (!resolution) return undefined;
        const r = String(resolution).toLowerCase();
        if (r === '1k' || r === '1024' || r === '1024px') return '1K';
        if (r === '2k' || r === '2048' || r === '2048px') return '2K';
        if (r === '4k' || r === '4096' || r === '4096px') return '4K';
        return undefined;
    }

    extractFirstInlineImagePart(responseJson) {
        const parts = responseJson?.candidates?.[0]?.content?.parts;
        if (!Array.isArray(parts)) return null;
        const imgPart = parts.find(p => p?.inlineData?.data);
        if (!imgPart) return null;
        return {
            mimeType: imgPart.inlineData.mimeType || 'image/png',
            data: imgPart.inlineData.data
        };
    }

    async generateImage(params) {
        const model = this.mapImageModel(params.model) || this.mapImageModel('nano-banana-pro');
        if (!model) throw new Error(`Unsupported image model: ${params.model}`);

        const url = `${this.baseUrl}/models/${model}:generateContent`;
        const imageSize = this.resolutionToImageSize(params.resolution);

        const body = {
            contents: [{ parts: [{ text: params.prompt }] }],
            generationConfig: {
                responseModalities: ['Image'],
                imageConfig: {
                    ...(params.aspect_ratio ? { aspectRatio: params.aspect_ratio } : {}),
                    ...(imageSize ? { imageSize } : {})
                }
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API Request Failed: ${response.status} ${response.statusText} - ${errText.slice(0, 200)}`);
        }

        const data = await response.json();
        const imagePart = this.extractFirstInlineImagePart(data);
        if (!imagePart) throw new Error('No image returned by API');

        const urlOut = `data:${imagePart.mimeType};base64,${imagePart.data}`;
        return { id: crypto?.randomUUID?.() || Date.now().toString(), url: urlOut, raw: data };
    }

    async generateI2I(params) {
        const model = this.mapImageModel(params.model) || this.mapImageModel('nano-banana-pro');
        if (!model) throw new Error(`Unsupported image model: ${params.model}`);
        if (!params.image_inline?.data) throw new Error('Missing image_inline');

        const url = `${this.baseUrl}/models/${model}:generateContent`;
        const imageSize = this.resolutionToImageSize(params.resolution);

        const parts = [];
        if (params.prompt) parts.push({ text: params.prompt });
        parts.push({
            inlineData: {
                mimeType: params.image_inline.mimeType,
                data: params.image_inline.data
            }
        });

        const body = {
            contents: [{ parts }],
            generationConfig: {
                responseModalities: ['Image'],
                imageConfig: {
                    ...(params.aspect_ratio ? { aspectRatio: params.aspect_ratio } : {}),
                    ...(imageSize ? { imageSize } : {})
                }
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API Request Failed: ${response.status} ${response.statusText} - ${errText.slice(0, 200)}`);
        }

        const data = await response.json();
        const imagePart = this.extractFirstInlineImagePart(data);
        if (!imagePart) throw new Error('No image returned by API');
        const urlOut = `data:${imagePart.mimeType};base64,${imagePart.data}`;
        return { id: crypto?.randomUUID?.() || Date.now().toString(), url: urlOut, raw: data };
    }

    async pollOperation(operationName, { maxAttempts = 120, interval = 10000 } = {}) {
        const opUrl = `${this.baseUrl}/${operationName}`;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            await new Promise(resolve => setTimeout(resolve, interval));
            const response = await fetch(opUrl, { method: 'GET', headers: this.getHeaders() });
            if (!response.ok) {
                const errText = await response.text();
                if (attempt === maxAttempts) throw new Error(`Poll Failed: ${response.status} - ${errText.slice(0, 200)}`);
                continue;
            }

            const data = await response.json();
            if (data?.done) return data;
        }

        throw new Error('Generation timed out after polling.');
    }

    async downloadAuthedFileToObjectUrl(fileUri) {
        const response = await fetch(fileUri, { method: 'GET', headers: { 'x-goog-api-key': this.getKey() } });
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`File download failed: ${response.status} ${errText.slice(0, 200)}`);
        }
        const blob = await response.blob();
        return URL.createObjectURL(blob);
    }

    async generateVideo(params) {
        const model = this.mapVideoModel(params.model) || 'veo-3.1-generate-preview';
        const url = `${this.baseUrl}/models/${model}:predictLongRunning`;

        const body = {
            instances: [{ prompt: params.prompt }],
            parameters: {
                ...(params.aspect_ratio ? { aspectRatio: params.aspect_ratio } : {}),
                ...(params.duration ? { durationSeconds: params.duration } : {}),
                ...(params.resolution ? { resolution: params.resolution } : {})
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API Request Failed: ${response.status} ${response.statusText} - ${errText.slice(0, 200)}`);
        }

        const submitData = await response.json();
        const operationName = submitData?.name;
        if (!operationName) throw new Error('No operation returned by API');

        const op = await this.pollOperation(operationName);
        const uri = op?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
        if (!uri) throw new Error('No video URI returned by API');

        const objectUrl = await this.downloadAuthedFileToObjectUrl(uri);
        return { id: operationName, url: objectUrl, raw: op };
    }

    async generateI2V(params) {
        const model = this.mapVideoModel(params.model) || 'veo-3.1-generate-preview';
        if (!params.image_inline?.data) throw new Error('Missing image_inline');

        const url = `${this.baseUrl}/models/${model}:predictLongRunning`;

        const body = {
            instances: [{ prompt: params.prompt || '' }],
            parameters: {
                ...(params.aspect_ratio ? { aspectRatio: params.aspect_ratio } : {}),
                ...(params.duration ? { durationSeconds: params.duration } : {}),
                ...(params.resolution ? { resolution: params.resolution } : {}),
                referenceImages: [
                    {
                        image: {
                            inlineData: {
                                mimeType: params.image_inline.mimeType,
                                data: params.image_inline.data
                            }
                        },
                        referenceType: 'asset'
                    }
                ]
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API Request Failed: ${response.status} ${response.statusText} - ${errText.slice(0, 200)}`);
        }

        const submitData = await response.json();
        const operationName = submitData?.name;
        if (!operationName) throw new Error('No operation returned by API');

        const op = await this.pollOperation(operationName);
        const uri = op?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
        if (!uri) throw new Error('No video URI returned by API');

        const objectUrl = await this.downloadAuthedFileToObjectUrl(uri);
        return { id: operationName, url: objectUrl, raw: op };
    }

    async uploadFile() {
        throw new Error('uploadFile is not supported for Google AI client. Use inlineData uploads.');
    }
}

export const muapi = new MuapiClient();
