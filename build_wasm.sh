#!/bin/bash
# Exit immediately if a command exits with a non-zero status.
set -e

# --- Configuration Variables ---
# Use environment variables from Dockerfile or runtime.
PROJ_VERSION=${PROJ_VERSION:-9.7.0}
PROJ_REPO=${PROJ_REPO:-https://github.com/OSGeo/PROJ.git}
PROJ_BRANCH=${PROJ_BRANCH:-${PROJ_VERSION}} # If PROJ_BRANCH is not set, use PROJ_VERSION
EMSDK_PATH=${EMSDK_PATH:-/emsdk}
BUILD_DIR=${BUILD_DIR:-/build}
INSTALL_DIR=${INSTALL_DIR:-/usr/local/wasm}
PROJ_SRC_DIR="${BUILD_DIR}/proj_src"
DEPS_SRC_DIR="${BUILD_DIR}/deps_src"
TEMP_BUILD_DIR="${BUILD_DIR}/temp_build"

# Emscripten flags for Pthreads (multithreading support)
EM_PTHREADS_FLAGS="-pthread -matomics -mbulk-memory -fexceptions"
EM_LINKER_PTHREADS_FLAGS="-s USE_PTHREADS=1"


# --- Utility Functions ---

function log_step {
    echo ""
    echo "--- $1 ---"
    echo ""
}

function configure_cmake {
    # Use emcmake wrapper to correctly configure the toolchain
    emcmake cmake "$@" \
        -D CMAKE_INSTALL_PREFIX="${INSTALL_DIR}" \
        -D CMAKE_BUILD_TYPE=Release \
        -D BUILD_SHARED_LIBS=OFF \
        -D CMAKE_C_FLAGS="${EM_PTHREADS_FLAGS}" \
        -D CMAKE_CXX_FLAGS="${EM_PTHREADS_FLAGS}" \
        -D CMAKE_EXE_LINKER_FLAGS="${EM_LINKER_PTHREADS_FLAGS}" \
        -D CMAKE_FIND_ROOT_PATH="${INSTALL_DIR}" \
        -D CMAKE_FIND_ROOT_PATH_MODE_PACKAGE=ONLY \
        -D CMAKE_FIND_ROOT_PATH_MODE_LIBRARY=ONLY \
        -D CMAKE_FIND_ROOT_PATH_MODE_INCLUDE=ONLY
}

function build_and_install {
    # Use emmake wrapper to build and install using the emscripten toolchain
    emmake make -j$(nproc)
    emmake make install
}

# --- Preparation ---

log_step "1. Setting up Environment and Directories"

# Clean build directories to ensure a fresh build
rm -rf ${TEMP_BUILD_DIR}
# We keep DEPS_SRC_DIR to cache downloads
mkdir -p ${TEMP_BUILD_DIR}
mkdir -p ${DEPS_SRC_DIR}

# Source the Emscripten environment script in the current shell
source "${EMSDK_PATH}/emsdk_env.sh" > /dev/null

echo "PROJ Version/Branch: ${PROJ_BRANCH}"
echo "Installation target: ${INSTALL_DIR}"

# --- 2. Build and Install Zlib (Dependency) ---

log_step "2. Building and Installing Zlib"

if [ -f "${INSTALL_DIR}/lib/libz.a" ]; then
    echo "Zlib static library already found. Skipping build."
else
    ZLIB_DIR="${DEPS_SRC_DIR}/zlib-1.3.1"
    cd ${DEPS_SRC_DIR}
    if [ ! -f "v1.3.1.zip" ]; then
        wget "https://github.com/madler/zlib/archive/refs/tags/v1.3.1.zip"
    fi
    unzip -qo v1.3.1.zip
    cd ${ZLIB_DIR}

    mkdir -p build_wasm
    cd build_wasm

    configure_cmake ..
    build_and_install
fi

# --- 3. Build and Install LibTIFF (Dependency) ---

log_step "3. Building and Installing LibTIFF"

if [ -f "${INSTALL_DIR}/lib/libtiff.a" ]; then
    echo "LibTIFF static library already found. Skipping build."
else
    TIFF_DIR="${DEPS_SRC_DIR}/tiff-4.0.10"
    cd ${DEPS_SRC_DIR}
    if [ ! -f "tiff-4.0.10.zip" ]; then
        wget "https://download.osgeo.org/libtiff/tiff-4.0.10.zip"
    fi
    unzip -qo tiff-4.0.10.zip
    cd ${TIFF_DIR}

    mkdir -p build_wasm
    cd build_wasm

    configure_cmake .. \
        -D TIFF_BUILD_SHARED=OFF \
        -D TIFF_BUILD_TOOLS=OFF \
        -D TIFF_BUILD_TESTS=OFF \
        -D TIFF_ENABLE_LZMA=OFF \
        -D ZLIB_INCLUDE_DIR="${INSTALL_DIR}/include" \
        -D ZLIB_LIBRARY="${INSTALL_DIR}/lib/libz.a"
    build_and_install
fi

# --- 4. Build and Install SQLite3 (Dependency) ---

log_step "4. Building and Installing SQLite3"

# Check if both the library AND the header exist before skipping
if [ -f "${INSTALL_DIR}/lib/libsqlite3.a" ] && [ -f "${INSTALL_DIR}/include/sqlite3.h" ]; then
    echo "SQLite3 static library and header already found. Skipping build."
else
    SQLITE_VERSION="3440200"
    SQLITE_AMALGAMATION_DIR="${DEPS_SRC_DIR}/sqlite3_amalgamation"
    mkdir -p ${SQLITE_AMALGAMATION_DIR}

    cd ${SQLITE_AMALGAMATION_DIR}
    if [ ! -f "sqlite-amalgamation-${SQLITE_VERSION}.zip" ]; then
        wget "https://sqlite.org/2023/sqlite-amalgamation-${SQLITE_VERSION}.zip"
    fi
    unzip -qo sqlite-amalgamation-${SQLITE_VERSION}.zip
    # Move files to the parent directory for a flat structure
    mv sqlite-amalgamation-${SQLITE_VERSION}/* .
    rmdir sqlite-amalgamation-${SQLITE_VERSION}

    # Step 4a: Compile SQLite3 to an object file (.o)
    emcc sqlite3.c \
        -o ${TEMP_BUILD_DIR}/sqlite3.o \
        -c \
        -O3 \
        -DSQLITE_THREADSAFE=1 \
        -D_REENTRANT \
        ${EM_PTHREADS_FLAGS}

    # Step 4b: Create the static library archive (.a) from the object file
    # We use 'emmake ar' which is the Emscripten wrapper for the archiver
    emmake ar rcs ${INSTALL_DIR}/lib/libsqlite3.a ${TEMP_BUILD_DIR}/sqlite3.o

    # Copy the header to the install directory
    mkdir -p ${INSTALL_DIR}/include
    # Force copy to overwrite any broken symlinks from previous runs
    rm -f ${INSTALL_DIR}/include/sqlite3.h
    cp ${SQLITE_AMALGAMATION_DIR}/sqlite3.h ${INSTALL_DIR}/include/sqlite3.h
fi


# --- 5. Download PROJ Source ---

log_step "5. Downloading PROJ Source"

echo "Checking ${PROJ_SRC_DIR}"
if [ ! -d "${PROJ_SRC_DIR}/.git" ]; then
    if [ -d "${PROJ_SRC_DIR}" ] && [ "$(ls -A ${PROJ_SRC_DIR})" ]; then
        echo "Local PROJ source found at ${PROJ_SRC_DIR}. Skipping clone."
    else
        echo "Cloning PROJ repository: ${PROJ_REPO}"
        git clone --depth 1 --branch ${PROJ_BRANCH} ${PROJ_REPO} ${PROJ_SRC_DIR}
    fi
else
    echo "PROJ source directory already exists. Skipping clone."
fi

cd ${PROJ_SRC_DIR}

# --- 6. Build and Install PROJ ---
# This step uses the NATIVE sqlite3 binary
# to generate proj.db, which is then embedded into libproj.a.

log_step "6. Building and Installing PROJ"

if [ -f "${INSTALL_DIR}/lib/libproj.a" ]; then
    echo "PROJ static library already found. Skipping build."
else
    PROJ_BUILD_WASM_DIR="${PROJ_SRC_DIR}/build_wasm"
    # Ensure a clean build directory
    ### keep for cache ### rm -rf ${PROJ_BUILD_WASM_DIR}
    mkdir -p ${PROJ_BUILD_WASM_DIR}
    cd ${PROJ_BUILD_WASM_DIR}

    # Configure PROJ, explicitly telling it where to find the dependencies
    # and specifying the native SQLite3 executable for db generation.
    configure_cmake .. \
        -D BUILD_TESTING=OFF \
        -D BUILD_APPS=OFF \
        -D PROJ_TESTS_EXTERNAL_DATA=OFF \
        -D ENABLE_TIFF=ON \
        -D ENABLE_CURL=OFF \
        -D ENABLE_SQLITE=ON \
        -D ENABLE_EMSCRIPTEN_FETCH=ON \
        -D CMAKE_C_FLAGS="-pthread -matomics -mbulk-memory" \
        -D CMAKE_CXX_FLAGS="-pthread -matomics -mbulk-memory" \
        -D EXE_SQLITE3=/usr/bin/sqlite3 \
        -D SQLite3_INCLUDE_DIR="${INSTALL_DIR}/include" \
        -D SQLite3_LIBRARY="${INSTALL_DIR}/lib/libsqlite3.a" \
        -D TIFF_INCLUDE_DIR="${INSTALL_DIR}/include" \
        -D TIFF_LIBRARY="${INSTALL_DIR}/lib/libtiff.a" \
        -D ZLIB_INCLUDE_DIR="${INSTALL_DIR}/include" \
        -D ZLIB_LIBRARY="${INSTALL_DIR}/lib/libz.a"

    build_and_install
fi

# --- 6.5 Create C Wrappers ---
log_step "6.5 Creating C Wrapper Functions"

# Create a C file with functions to return the version numbers
# We must include proj.h from the *install* directory
DDD=`date +"%Y-%m-%dT%H:%M:%S%z" -u`
cat << EOF > ${BUILD_DIR}/proj_wrappers.c
#include "proj.h"
#include "math.h"

const char* get_compilation_date() {
    return "$DDD" ;
}

int get_proj_info_sizeof() {
    return sizeof(PJ_INFO);
}
EOF

# Compile the wrapper into an object file
emcc ${BUILD_DIR}/proj_wrappers.c \
    -c \
    -o ${BUILD_DIR}/proj_wrappers.o \
    -I${INSTALL_DIR}/include \
    ${EM_PTHREADS_FLAGS}

# --- 7. Final WASM Module Generation ---
# Link all the static libraries and the wrapper object file
# into the final JS/WASM module and expose functions.

log_step "7. Generating Final WASM Module (projModule.js + .wasm)"

FINAL_LIBS="${INSTALL_DIR}/lib/libproj.a \
            ${INSTALL_DIR}/lib/libsqlite3.a \
            ${INSTALL_DIR}/lib/libtiff.a \
            ${INSTALL_DIR}/lib/libz.a \
            ${BUILD_DIR}/proj_wrappers.o"

# Note: We no longer need --preload-file for proj.db
# It is now embedded directly in libproj.a by the build process in Step 6.

    #-O0 -g \
    #-O3 \
    #-s PTHREAD_POOL_SIZE=2 \

emcc ${FINAL_LIBS} \
    -o ${INSTALL_DIR}/projModule.js \
    -O3 \
    -s STACK_OVERFLOW_CHECK=2 \
    -s STACK_SIZE=5MB \
    -s ASSERTIONS \
    -s NO_DISABLE_EXCEPTION_CATCHING \
    -s FETCH=1 \
    -s USE_PTHREADS=1 \
    -s FETCH_SUPPORT_INDEXEDDB=0 \
    -s ASYNCIFY=1 \
    -s ASYNCIFY_STACK_SIZE=16384 \
    -s WASM=1 \
    -s MODULARIZE=1 \
    -s EXPORT_NAME="'ProjModuleFactory'" \
    -s FORCE_FILESYSTEM=1 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s EXPORTED_RUNTIME_METHODS="['ccall','cwrap','FS','HEAPF64','stringToNewUTF8','UTF8ToString','getValue']" \
    -s EXPORTED_FUNCTIONS="[
     '_get_proj_info_sizeof',
     '_get_compilation_date',
     '_proj_info',
     '_proj_context_errno_string',
     '_proj_context_create', '_proj_context_set_enable_network',
     '_proj_create', '_proj_create_from_database',
     '_proj_create_crs_to_crs', '_proj_create_crs_to_crs_from_pj',
     '_proj_context_destroy',
     '_proj_destroy', '_proj_trans', '_proj_trans_array', '_malloc', '_free']" \
    ${EM_PTHREADS_FLAGS}

# --- 8. Set File Permissions ---
log_step "8. Setting file ownership"

# Get the user and group ID from the mounted install directory (the host)
HOST_UID=$(stat -c %u ${INSTALL_DIR})
HOST_GID=$(stat -c %g ${INSTALL_DIR})

if [ "$HOST_UID" -ne 0 ] || [ "$HOST_GID" -ne 0 ]; then
    echo "Changing ownership of ${INSTALL_DIR} to ${HOST_UID}:${HOST_GID}"
    chown -R ${HOST_UID}:${HOST_GID} ${INSTALL_DIR}
else
    echo "Running as root, no ownership change needed."
fi

log_step "BUILD SUCCESSFUL!"
echo "Artifacts are installed in ${INSTALL_DIR}"
