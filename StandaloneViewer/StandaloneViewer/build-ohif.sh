#!/bin/bash
METEOR_PACKAGE_DIRS="../../Packages" meteor-build-client-fixed ../../../newpacs/compilado -u http://visor.storage.lan/
temp=$PWD
cd ../../../newpacs/compilado
mkdir api
cp ../../ohif-toth/StandaloneViewer/etc/sampleJpeg.json api/test.json
cp ../../ohif-toth/StandaloneViewer/etc/redirectingSimpleServer.py .
#python ../etc/redirectingSimpleServer.py
cd $temp
#METEOR_PACKAGE_DIRS="../../Packages" ROOT_URL=http://localhost:3000 meteor

