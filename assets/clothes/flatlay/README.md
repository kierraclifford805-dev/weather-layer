# 衣物平铺素材 · 2026-11-05

由内置 image_gen 生成的衣物款式示意，非品牌商品、非用户衣橱照片。未使用用户照片作为参考。画面中的颜色不参与推荐；衣物种类与厚薄仍由原有天气规则决定。用户有匹配衣物时继续使用本机照片。

## 生成约束

Use case: product-mockup. Asset type: single garment cutout for an elegant daily wardrobe web app. Unbranded gender-neutral everyday clothing. Photographed directly overhead, neatly laid flat, front facing upward, whole garment upright and fully visible. Premium editorial e-commerce photography, tactile matte fabric with a few gentle natural folds and realistic seams. Understated soft light from top left. Centered with generous 12% transparent empty margin on all sides. True transparent background, only soft close contact shadow, no surface, no mannequin, no human, no hanger, no accessories, no lettering or logo, no frame. Muted warm neutral palette, crisp natural detail without excessive wrinkles. Square composition.

工具参数：`transparent_background: true`。短袖初次提示额外指定 ivory off-white cotton crew-neck short-sleeve t-shirt, regular relaxed fit, realistic seams and ribbed collar。

## 各款主题提示

| 文件 | Subject |
| --- | --- |
| tshirt.webp | a single unbranded ivory off-white cotton crew-neck short-sleeve t-shirt, gender-neutral regular relaxed fit |
| light-jacket.webp | a single light sand beige lightweight cotton-linen overshirt, thin fabric, long sleeves naturally spread gently down, open front with small buttons, a neat relaxed collar and two simple chest pockets, unstructured shirt-like silhouette, not a trench or heavy coat |
| trousers.webp | a single pair of dark muted navy lightweight straight-leg cotton trousers, full length, gently tapered loose straight legs, elegant tailored waistband, no belt, both legs fully visible |
| longsleeve.webp | a single warm ivory cotton long-sleeve crew neck top, thin lightweight fabric, regular relaxed fit, sleeves naturally spread gently down |
| knit.webp | a single oatmeal fine knitted crew-neck sweater, long sleeves, softly rounded shoulders, neat ribbed cuffs and hem, visible natural knit stitch texture |
| jacket.webp | a single muted slate blue regular-weight cotton chore jacket, long sleeves, structured but relaxed silhouette, button front, simple collar and practical pockets |
| coat.webp | a single warm taupe wool coat, mid-thigh length, heavy matte wool, simple lapels, clean single-breasted front and two pockets, long sleeves |
| puffer.webp | a single muted deep navy winter down puffer jacket, long sleeves, neat broad horizontal quilted baffles, short stand collar, matte fabric and central zip |
| base-layer.webp | a single warm grey fitted thermal long-sleeve crew neck undershirt, smooth fine wool fabric, simple lightweight close-fitting silhouette |
| shorts.webp | a single pair of light sand beige relaxed Bermuda cotton shorts, above-knee length, tailored waistband, clean simple pockets, both legs visible |

## 文件处理

保留生成原稿，仅将透明图按最长边 640px 转为 WebP（quality 84，compression 6）。没有替换用户衣橱、自动识别衣物或声称生成图片是真实商品。路径统一在 `visuals.js` 维护。原有 SVG 保留可回退；帽子、雨伞、防晒霜、水杯继续用简洁 SVG。

