rm -rf dist/libffmpeg_$1.wasm dist/libffmpeg_$1.js
export TOTAL_MEMORY=67108864
export EXPORTED_FUNCTIONS="[ \
		'_openDecoder', \
		'_flushDecoder', \
		'_closeDecoder', \
    '_decodeData', \
    '_main'
]"

echo "Running Emscripten..."
emcc decode_video.c ffmpeg/lib/libavcodec.a ffmpeg/lib/libavutil.a ffmpeg/lib/libswscale.a \
    -O2 \
    -I "ffmpeg/include" \
    -s WASM=1 \
    -s TOTAL_MEMORY=${TOTAL_MEMORY} \
   	-s EXPORTED_FUNCTIONS="${EXPORTED_FUNCTIONS}" \
   	-s EXTRA_EXPORTED_RUNTIME_METHODS="['addFunction']" \
		-s RESERVED_FUNCTION_POINTERS=14 \
		-s FORCE_FILESYSTEM=1 \
    -o dist/libffmpeg_$1.js

echo "Finished Build"
