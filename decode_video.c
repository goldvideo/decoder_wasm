 /**
  * @file
  * video decoding with libavcodec API example
  *
  * decode_video.c
  */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef void(*VideoCallback)(unsigned char* data_y, unsigned char* data_u, unsigned char* data_v, int line1, int line2, int line3, int width, int height, long pts);

#include <libavcodec/avcodec.h>

#define INBUF_SIZE 4096

typedef enum ErrorCode {
	kErrorCode_Success = 0,
	kErrorCode_Invalid_Param,
	kErrorCode_Invalid_State,
	kErrorCode_Invalid_Data,
	kErrorCode_Invalid_Format,
	kErrorCode_NULL_Pointer,
	kErrorCode_Open_File_Error,
	kErrorCode_Eof,
	kErrorCode_FFmpeg_Error
}ErrorCode;

typedef enum LogLevel {
	kLogLevel_None, //Not logging.
	kLogLevel_Core, //Only logging core module(without ffmpeg).
	kLogLevel_All   //Logging all, with ffmpeg.
}LogLevel;

typedef enum DecoderType {
	kDecoderType_H264,
	kDecoderType_H265
}DecoderType;

LogLevel logLevel = kLogLevel_None;
DecoderType decoderType = kDecoderType_H265;

void simpleLog(const char* format, ...) {
	if (logLevel == kLogLevel_None) {
		return;
	}

	char szBuffer[1024] = { 0 };
	char szTime[32] = { 0 };
	char* p = NULL;
	int prefixLength = 0;
	const char* tag = "Core";

	prefixLength = sprintf(szBuffer, "[%s][%s][DT] ", szTime, tag);
	p = szBuffer + prefixLength;

	if (1) {
		va_list ap;
		va_start(ap, format);
		vsnprintf(p, 1024 - prefixLength, format, ap);
		va_end(ap);
	}

	printf("%s\n", szBuffer);
}

void ffmpegLogCallback(void* ptr, int level, const char* fmt, va_list vl) {
	static int printPrefix = 1;
	static int count = 0;
	static char prev[1024] = { 0 };
	char line[1024] = { 0 };
	static int is_atty;
	AVClass* avc = ptr ? *(AVClass**)ptr : NULL;
	if (level > AV_LOG_DEBUG) {
		return;
	}

	line[0] = 0;

	if (printPrefix && avc) {
		if (avc->parent_log_context_offset) {
			AVClass** parent = *(AVClass***)(((uint8_t*)ptr) + avc->parent_log_context_offset);
			if (parent && *parent) {
				snprintf(line, sizeof(line), "[%s @ %p] ", (*parent)->item_name(parent), parent);
			}
		}
		snprintf(line + strlen(line), sizeof(line) - strlen(line), "[%s @ %p] ", avc->item_name(ptr), ptr);
	}

	vsnprintf(line + strlen(line), sizeof(line) - strlen(line), fmt, vl);
	line[strlen(line) + 1] = 0;
	simpleLog("%s", line);
}

VideoCallback videoCallback = NULL;

ErrorCode copyFrameData(AVFrame* src, AVFrame* dst, long ptslist[]) {
	ErrorCode ret = kErrorCode_Success;
	memcpy(dst->data, src->data, sizeof(src->data));
	dst->linesize[0] = src->linesize[0];
	dst->linesize[1] = src->linesize[1];
	dst->linesize[2] = src->linesize[2];
	dst->width = src->width;
	dst->height = src->height;
	long pts = LONG_MAX;
	int index = -1;
	for (int i = 0; i < 10; i++) {
		if (ptslist[i] < pts) {
			pts = ptslist[i];
			index = i;
		}
	}
	if (index > -1) {
		ptslist[index] = LONG_MAX;
	}
	dst->pts = pts;
	return ret;
}

unsigned char* yuvBuffer;
int videoSize = 0;
int initBuffer(width, height) {
	videoSize = avpicture_get_size(AV_PIX_FMT_YUV420P, width, height);
	int bufferSize = 3 * videoSize;
	yuvBuffer = (unsigned char*)av_mallocz(bufferSize);
}

static ErrorCode decode(AVCodecContext* dec_ctx, AVFrame* frame, AVPacket* pkt, AVFrame* outFrame, long ptslist[])
{
	ErrorCode res = kErrorCode_Success;
	char buf[1024];
	int ret;

	ret = avcodec_send_packet(dec_ctx, pkt);
	if (ret < 0) {
		simpleLog("Error sending a packet for decoding\n");
		res = kErrorCode_FFmpeg_Error;
	}
	else {
		while (ret >= 0) {
			ret = avcodec_receive_frame(dec_ctx, frame);
			if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF) {
				break;
			}
			else if (ret < 0) {
				simpleLog("Error during decoding\n");
				res = kErrorCode_FFmpeg_Error;
				break;
			}

			res = copyFrameData(frame, outFrame, ptslist);
			if (res != kErrorCode_Success) {
				break;
			}

			videoCallback(outFrame->data[0], outFrame->data[1], outFrame->data[2], outFrame->linesize[0], outFrame->linesize[1], outFrame->linesize[2], outFrame->width, outFrame->height, outFrame->pts);

		}
	}
	return res;
}

int isInit = 0;
const AVCodec* codec;
AVCodecParserContext* parser;
AVCodecContext* c = NULL;
AVPacket* pkt;
AVFrame* frame;
AVFrame* outFrame;
long ptslist[10];

ErrorCode openDecoder(int codecType, long callback, int logLv) {
	ErrorCode ret = kErrorCode_Success;
	do {
		simpleLog("Initialize decoder.");

		if (isInit != 0) {
			break;
		}

		decoderType = codecType;
		logLevel = logLv;

		if (logLevel == kLogLevel_All) {
			av_log_set_callback(ffmpegLogCallback);
		}

		/* find the video decoder */
		if (decoderType == kDecoderType_H264) {
			codec = avcodec_find_decoder(AV_CODEC_ID_H264);
		} else {
			codec = avcodec_find_decoder(AV_CODEC_ID_H265);
		}

		if (!codec) {
			simpleLog("Codec not found\n");
			ret = kErrorCode_FFmpeg_Error;
			break;
		}

		parser = av_parser_init(codec->id);
		if (!parser) {
			simpleLog("parser not found\n");
			ret = kErrorCode_FFmpeg_Error;
			break;
		}

		c = avcodec_alloc_context3(codec);
		if (!c) {
			simpleLog("Could not allocate video codec context\n");
			ret = kErrorCode_FFmpeg_Error;
			break;
		}

		if (avcodec_open2(c, codec, NULL) < 0) {
			simpleLog("Could not open codec\n");
			ret = kErrorCode_FFmpeg_Error;
			break;
		}

		frame = av_frame_alloc();
		if (!frame) {
			simpleLog("Could not allocate video frame\n");
			ret = kErrorCode_FFmpeg_Error;
			break;
		}

		outFrame = av_frame_alloc();
		if (!outFrame) {
			simpleLog("Could not allocate video frame\n");
			ret = kErrorCode_FFmpeg_Error;
			break;
		}

		pkt = av_packet_alloc();
		if (!pkt) {
			simpleLog("Could not allocate video packet\n");
			ret = kErrorCode_FFmpeg_Error;
			break;
		}

		for (int i = 0; i < 10; i++) {
			ptslist[i] = LONG_MAX;
		}

		videoCallback = (VideoCallback)callback;

	} while (0);
	simpleLog("Decoder initialized %d.", ret);
	return ret;
}

ErrorCode decodeData(unsigned char* data, size_t data_size, long pts) {
	ErrorCode ret = kErrorCode_Success;

	for (int i = 0; i < 10; i++) {
		if (ptslist[i] == LONG_MAX) {
			ptslist[i] = pts;
			break;
		}
	}

	while (data_size > 0) {
		int size = av_parser_parse2(parser, c, &pkt->data, &pkt->size,
			data, data_size, AV_NOPTS_VALUE, AV_NOPTS_VALUE, 0);
		if (size < 0) {
			simpleLog("Error while parsing\n");
			ret = kErrorCode_FFmpeg_Error;
			break;
		}
		data += size;
		data_size -= size;

		if (pkt->size) {
			ret = decode(c, frame, pkt, outFrame, ptslist);
			if (ret != kErrorCode_Success) {
                break;
            }
		}
	}
	return ret;
}

ErrorCode flushDecoder() {
	/* flush the decoder */
	return decode(c, frame, NULL, outFrame, ptslist);
}

ErrorCode closeDecoder() {
	ErrorCode ret = kErrorCode_Success;

	do {
		if (parser != NULL) {
			av_parser_close(parser);
			simpleLog("Video codec context closed.");
		}
		if (c != NULL) {
			avcodec_free_context(&c);
			simpleLog("Video codec context closed.");
		}
		if (frame != NULL) {
			av_frame_free(&frame);
		}
		if (pkt != NULL) {
			av_packet_free(&pkt);
		}
		if (yuvBuffer != NULL) {
			av_freep(&yuvBuffer);
		}
		if (outFrame != NULL) {
			av_frame_free(&outFrame);
		}
		simpleLog("All buffer released.");
	} while (0);

	return ret;
}

int callbackIndex = 0;
void vcb_frame(unsigned char* data_y, unsigned char* data_u, unsigned char* data_v, int line1, int line2, int line3, int width, int height, long pts) {
	simpleLog("[%d]In video call back, size = %d * %d, pts = %ld\n", ++callbackIndex, width, height, pts);
	int i = 0;
	unsigned char* src = NULL;
	FILE* dst = fopen("vcb.yuv", "a");
	for (i = 0; i < height; i++) {
		src = data_y + i * line1;
		fwrite(src, width, 1, dst);
	}

	for (i = 0; i < height / 2; i++) {
		src = data_u + i * line2;
		fwrite(src, width/2, 1, dst);
	}

	for (i = 0; i < height / 2; i++) {
		src = data_v + i * line3;
		fwrite(src, width/2, 1, dst);
	}

	fclose(dst);
}

int main(int argc, char** argv)
{
//		openDecoder(1, vcb_frame, kLogLevel_Core);
//
//		//const char* filename = "Forrest_Gump_IMAX.h264";
//		const char* filename = "FourPeople_1280x720_60_1M.265";
//
//		FILE* f;
//
//		//   uint8_t *data;
//		size_t   data_size;
//
//		//uint8_t inbuf[INBUF_SIZE + AV_INPUT_BUFFER_PADDING_SIZE];
//		///* set end of buffer to 0 (this ensures that no overreading happens for damaged MPEG streams) */
//		//memset(inbuf + INBUF_SIZE, 0, AV_INPUT_BUFFER_PADDING_SIZE);
//
//		char* buffer;
//		buffer = (char*)malloc(sizeof(char) * (INBUF_SIZE + AV_INPUT_BUFFER_PADDING_SIZE));
//		if (buffer == NULL) {
//			simpleLog("Memory error");
//			exit(2);
//		}
//
//		f = fopen(filename, "rb");
//		if (!f) {
//			simpleLog("Could not open %s\n", filename);
//			exit(1);
//		}
//
//		while (!feof(f)) {
//			/* read raw data from the input file */
//			//data_size = fread(inbuf, 1, INBUF_SIZE, f);
//			data_size = fread(buffer, 1, INBUF_SIZE, f);
//
//			if (!data_size)
//				break;
//
//			/* use the parser to split the data into frames */
//			//data = inbuf;
//			decodeData(buffer, data_size, 0);
//		}
//		fclose(f);
//		free(buffer);
//
//		flushDecoder();
//		closeDecoder();

	return 0;
}
