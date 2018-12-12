Prerequisites
======
Download the following models to this directory:

 - [DeepLab (with Atrous Conv)](https://drive.google.com/file/d/1La9pi75J6RwSkgYcme1d9FLL4LZ3_JnE/view?usp=sharing)
 - [DeepLab](https://drive.google.com/file/d/15l8kxoM0JBXv3Nd-BpyAQ7oZpgJWkKd3/view?usp=sharing)


This directory should contain following files
```txt
deeplab_mobilenetv2_513.tflite
deeplab_mobilenetv2_513_dilated.tflite
```

These two models are equivalent. The latter is used for platforms (Android) that do not natively support atrous convolution. They are converted from this [DeepLab checkpoint](http://download.tensorflow.org/models/deeplabv3_mnv2_pascal_trainval_2018_01_29.tar.gz). You can follow the steps below to convert your own model.

# Convert From `.pb` to `.tflite`


1. Download Tensorflow source if you previously intalled it with package manager.
```sh
git clone https://github.com/tensorflow/tensorflow.git
cd tensorflow

```