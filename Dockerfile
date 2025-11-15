# Use the latest Ubuntu LTS as the base image
FROM ubuntu:24.04

# Force /bin/bash as the default shell for all RUN commands
SHELL ["/bin/bash", "-c"]

# Set non-interactive frontend for package installations
ENV DEBIAN_FRONTEND="noninteractive"

# --- Install System Dependencies ---
# Update apt, install build tools, Git, Emscripten prerequisites,
# and the native sqlite3 utility.
RUN apt-get update && \
    apt-get install -y \
    build-essential \
    cmake \
    curl \
    git \
    python3 \
    ninja-build \
    wget \
    unzip \
    ca-certificates \
    sqlite3 && \
    # Clean up apt cache to reduce image size
    rm -rf /var/lib/apt/lists/*

# --- Install Emscripten SDK ---
# Set paths for Emscripten
ENV EMSDK_PATH="/emsdk"
ENV EMSDK_VERSION="3.1.55"

# Clone the Emscripten SDK
RUN git clone https://github.com/emscripten-core/emsdk.git ${EMSDK_PATH}
WORKDIR ${EMSDK_PATH}

# Install and activate the specified SDK version
RUN ./emsdk install ${EMSDK_VERSION} && \
    ./emsdk activate ${EMSDK_VERSION}

# Add Emscripten environment to .bashrc to make it available in the shell
RUN echo "source ${EMSDK_PATH}/emsdk_env.sh > /dev/null" >> /root/.bashrc

# --- Setup Build Directories ---
# Define standard locations for building and installing
ENV BUILD_DIR="/build"
ENV SCRIPT_DIR="/script"
ENV INSTALL_DIR="/usr/local/wasm"
ENV PROJ_VERSION="9.7.0"

# Create the directories
RUN mkdir -p ${BUILD_DIR}/proj_src \
             ${BUILD_DIR}/deps_src \
             ${INSTALL_DIR}

# Copy the build script into the container
#COPY build_wasm.sh /build/build_wasm.sh
#RUN chmod +x /build/build_wasm.sh

COPY build_wasm.sh /script/build_wasm.sh
RUN chmod +x /script/build_wasm.sh

# Set the main command to execute the build script
WORKDIR /build
#CMD ["/build/build_wasm.sh"]
CMD ["/script/build_wasm.sh"]
