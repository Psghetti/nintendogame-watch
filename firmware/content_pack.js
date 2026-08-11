/* ===========================================================================
   firmware/content_pack.js  —  in-browser "content pack" loader
   ---------------------------------------------------------------------------
   Lets a user open ONE .zip of their own dumps + segment-artwork SVGs +
   colour-unit flash images, and identifies + loads everything the SAME way
   firmware/build_gnw_roms.ps1 does, but entirely in the browser:

     • classic ROMs / melodies  — by SHA-256 content hash (with the same
                                    truncation fallback for zero-padded dumps),
     • segment artwork SVGs      — by SHA-256 whole-file hash → svgPath,
     • colour-unit (TFT) flash   — by exact size + pairing (131072 internal
                                    plus 1048576→mario / 4194304→zelda), grouped
                                    per archive/folder so both units in one zip
                                    stay separate.

   The result is stored in IndexedDB, so it persists across reloads/visits until
   the user clears it. NOTHING sensitive ships in this file — only the very same
   hash/size manifest the PowerShell builder embeds (no ROM/flash/art bytes).

   It's an ALTERNATIVE to running the builder: if the pre-built JSON/JS content
   files are installed they win; otherwise gnw.js and the TFT twin
   fall back to whatever this pack holds.  Zero external libraries — the zip is
   read with the browser's own DecompressionStream + a small directory parser.
   =========================================================================== */
(function () {
  'use strict';

  // --- identity manifest (hashes + sizes only, generated from the builder) ----
  var ROM_MANIFEST = [
{"sha256":"1b1bb844c4bb0481a87e6c114a438b2d4e308c1581f4e7dd7dfa7ff8222d1cfd","bytes":1856,"device":"ball","part":"rom"},
{"sha256":"1b1bb844c4bb0481a87e6c114a438b2d4e308c1581f4e7dd7dfa7ff8222d1cfd","bytes":1856,"device":"ballreissue","part":"rom"},
{"sha256":"38bfbb54eedb3761804d6e659da76e2c2dc0f916606ca081a6f0854c15aaba05","bytes":4096,"device":"bfight","part":"rom"},
{"sha256":"7f17e2032b8a0037d51f91aa0900f8c0e28d9a5e4e89c96ada1a893dcbc7ef2b","bytes":256,"device":"bfight","part":"melody"},
{"sha256":"38bfbb54eedb3761804d6e659da76e2c2dc0f916606ca081a6f0854c15aaba05","bytes":4096,"device":"bfightn","part":"rom"},
{"sha256":"7f17e2032b8a0037d51f91aa0900f8c0e28d9a5e4e89c96ada1a893dcbc7ef2b","bytes":256,"device":"bfightn","part":"melody"},
{"sha256":"3863a70f01819db79155f99eefb90219a01fe689d6940d02121bba60656f8d6c","bytes":4096,"device":"bjack","part":"rom"},
{"sha256":"771d34cd866ea5af60cbdf642f58844cbdb8621e5fbc37976aeeeb9933974f78","bytes":256,"device":"bjack","part":"melody"},
{"sha256":"4f559e796947bb11d3a8b5636669c5674c3aa4f75a05b7c343ae829601e031a1","bytes":4096,"device":"bombsweep","part":"rom"},
{"sha256":"3c45f3d0c049272344139d143b13a4e2ddbd213263062d8e1a1e682233b1636d","bytes":256,"device":"bombsweep","part":"melody"},
{"sha256":"927b582f26ee72230b4448867444bb800b259d1d1f16d7dce19e7adce16bd7a2","bytes":4096,"device":"boxing","part":"rom"},
{"sha256":"6e4736ebada050955f2f75ceeff85be744049510623ef6dc4286e37b411499ea","bytes":256,"device":"boxing","part":"melody"},
{"sha256":"9bcaafaefe6d8cbefdcdab1d5801ed471e3ba52c44f405479c886fed094a3641","bytes":4096,"device":"cgrab","part":"rom"},
{"sha256":"27fbd8bbfab1a8d7b2a484256f05e01426cf4170ffa79452c89181a620d8e20c","bytes":1856,"device":"chef","part":"rom"},
{"sha256":"aa151f4a31d8f140d6905f705156ca33cda0c548ac2b179df121ac7ed13120ad","bytes":4096,"device":"climber","part":"rom"},
{"sha256":"98cace3b07edacb62d989a1f258e063905f3ff99e27389d8cc5cd95f76a9d94b","bytes":256,"device":"climber","part":"melody"},
{"sha256":"aa151f4a31d8f140d6905f705156ca33cda0c548ac2b179df121ac7ed13120ad","bytes":4096,"device":"climbern","part":"rom"},
{"sha256":"98cace3b07edacb62d989a1f258e063905f3ff99e27389d8cc5cd95f76a9d94b","bytes":256,"device":"climbern","part":"melody"},
{"sha256":"e9fc7e4858c48faa54ec9bf890c0f1a5a2b18c3a22d168b505d515f7c940bfe3","bytes":4096,"device":"dkcirc","part":"rom"},
{"sha256":"cf90bba51dc00e01c0a168157db99b2aaf91ca83194644f8a9c7474b1d5a8430","bytes":256,"device":"dkcirc","part":"melody"},
{"sha256":"7b358188e341faf8dea9dd94717b70ae38a409eb134ec71fe00e7feca42f9778","bytes":4096,"device":"dkhockey","part":"rom"},
{"sha256":"1d7d2dfbbf3ac5c05032cbf811607522b452f54bd42959dc54d5f7714cdb17ab","bytes":256,"device":"dkhockey","part":"melody"},
{"sha256":"b279a9b2b6bcdcacbd09bdae869c63a8cbf378745280a5c33593ce48abc052be","bytes":4096,"device":"dkjr","part":"rom"},
{"sha256":"ccbfa247ea985d73d56b9c4bdfe9576736abc3520217047658c710645d0916e0","bytes":4096,"device":"dkjrp","part":"rom"},
{"sha256":"c0b8625e7e401df44c4f7fb407000e270ed0842ff99458eafab21a90c193568e","bytes":256,"device":"dkjrp","part":"melody"},
{"sha256":"ccbfa247ea985d73d56b9c4bdfe9576736abc3520217047658c710645d0916e0","bytes":4096,"device":"dkjrt","part":"rom"},
{"sha256":"c0b8625e7e401df44c4f7fb407000e270ed0842ff99458eafab21a90c193568e","bytes":256,"device":"dkjrt","part":"melody"},
{"sha256":"4112ef438bd98176e2e3f2b75a3bdcb856cdd07b297232ba7a8d992315464761","bytes":4096,"device":"dkong","part":"rom"},
{"sha256":"f93e876811487a37a5275de0f4cf0ae716d885573f8c1753d836c7eb03cb5613","bytes":4096,"device":"dkong2","part":"rom"},
{"sha256":"00db2b7d6060d0042358bc4d5be7e660be7e2eec6f5bb933bac8be5b2439ce56","bytes":4096,"device":"dkong3","part":"rom"},
{"sha256":"b2791b378620460b8ad9795d14eb1eeaae4a52c38ff67cf1a8c3e09a218ec6f0","bytes":256,"device":"dkong3","part":"melody"},
{"sha256":"28a225536ec129f227b8d3e261e6f10012206d0404d5f5d958c60bd71773fa7d","bytes":1856,"device":"egg","part":"rom"},
{"sha256":"0d955064089d66c8b0bf7a83fb36400c1630d02f24240c11759e88437682b575","bytes":1856,"device":"fire","part":"rom"},
{"sha256":"7e3d50dd31ae9ef5c9b4458dbc66854b87b6db99add3aa080967f09f655e29dc","bytes":4096,"device":"fireatk","part":"rom"},
{"sha256":"1005998c0be5af8491fa481d8793e62d47f47e3f9f709ef083aff9cd43950469","bytes":1856,"device":"firews","part":"rom"},
{"sha256":"4d61ea391bfa1d2da46c3baf4497d7bf0f2e6e482ce910c75d2ad1b259bd2b48","bytes":1856,"device":"flagman","part":"rom"},
{"sha256":"426a433e046ab437aec35283181992952e6db99cf06b4eb8d33e28e7366c6e6d","bytes":4096,"device":"gcliff","part":"rom"},
{"sha256":"242b2b65aa5189b3fa6dc29b801762767e1a6e026edd3d8ace8f63a0a0bf522e","bytes":256,"device":"gcliff","part":"melody"},
{"sha256":"d0b1756bdced26372e0524230a9cb72b882c566396ee0069386cd6b65c7247f0","bytes":4096,"device":"ghouse","part":"rom"},
{"sha256":"7c7aa1511ebf25964be6f2fb4e5764c37ea04ca3ff09d37b519816aa497d2058","bytes":1856,"device":"helmet","part":"rom"},
{"sha256":"f92ce28f00124c1da3627a5461f06d5157d45b1067e5f15c0a36edecdce67a68","bytes":1856,"device":"judge","part":"rom"},
{"sha256":"c5fc5f8c8b5fa21f0aa8a6448d57c961d6e53b8afa723efe3172e2c98141f194","bytes":4096,"device":"lboat","part":"rom"},
{"sha256":"16e1a9b9849ed0c5ebcf818e9ed64157528631ac110b4e649a4e339f08e99582","bytes":1856,"device":"lion","part":"rom"},
{"sha256":"bf1de11e8b450de8d6bde4a864848ccff31ac13d3329734ee006dfb5d232a36d","bytes":1856,"device":"manhole","part":"rom"},
{"sha256":"371cceca4dccbb6e30c9bd6f46c0a0647d6d0592dc1006b32299947931cf8998","bytes":4096,"device":"manholews","part":"rom"},
{"sha256":"e11cfc69bb14c03fcb5f849ac0697e2f0fca399095db09f80ee2f9f0e18ccd4c","bytes":4096,"device":"mario","part":"rom"},
{"sha256":"7aa3ba6730c53f968eb6af7efad3db2fdb99bafb020ba100fbe2454b8466672d","bytes":4096,"device":"mariocm","part":"rom"},
{"sha256":"6f997b63a6ad297c8a3df9de3d4008db1ef81f5999f49c6c27c14a1d486427bc","bytes":4096,"device":"mariocmt","part":"rom"},
{"sha256":"6e22de86c901f718f34f5814955e0cdcca2149f222559bb6402662b26bd626d9","bytes":256,"device":"mariocmt","part":"melody"},
{"sha256":"257aed0bb880a872b02ce237c9d7c3bf183fa65305440c3beafac73cf15b87d3","bytes":4096,"device":"mariotj","part":"rom"},
{"sha256":"7b0d8a978483d5d3534c97222e6f0e2f99796776ffd15b86a3fe645d12cb574b","bytes":256,"device":"mariotj","part":"melody"},
{"sha256":"8698ee42695d6e384a3237cbba5fe2da15acffb3214f4127830434574a37b0ff","bytes":4096,"device":"mbaway","part":"rom"},
{"sha256":"2657ae126ec3bf62392b5bd51061559cb1e4ec64b8a9fff56afc27c70224043c","bytes":256,"device":"mbaway","part":"melody"},
{"sha256":"273e8e4058a6b5279e4f4f82d02acba0e9a788d9b33533050460213daa83f735","bytes":4096,"device":"mickdon","part":"rom"},
{"sha256":"28a225536ec129f227b8d3e261e6f10012206d0404d5f5d958c60bd71773fa7d","bytes":1856,"device":"mmouse","part":"rom"},
{"sha256":"e9fc7e4858c48faa54ec9bf890c0f1a5a2b18c3a22d168b505d515f7c940bfe3","bytes":4096,"device":"mmousep","part":"rom"},
{"sha256":"cf90bba51dc00e01c0a168157db99b2aaf91ca83194644f8a9c7474b1d5a8430","bytes":256,"device":"mmousep","part":"melody"},
{"sha256":"4c45f7fe4df94bc15aeab606bbe2b20a606c272d3021ed64929c3ae67dce32c3","bytes":1856,"device":"octopus","part":"rom"},
{"sha256":"8e042b8e03f3a09f0c7fa4730fb2d6ce29c5265ae429993cdd7d0436758e9ef1","bytes":4096,"device":"opanic","part":"rom"},
{"sha256":"13f95a9d6e1d02677267b488476e09ab2b8d179112ab9da86397731a433b1bab","bytes":1856,"device":"pchute","part":"rom"},
{"sha256":"9dc1b7e3b7a7b2868127ee204849bdd92347548f75f8ca1e3c71ae58bef12138","bytes":4096,"device":"pinball","part":"rom"},
{"sha256":"ec11a70e9fa7bda13562f73c623bf4799404b35c1a8fd1d5b64b517d8e10cdcb","bytes":256,"device":"pinball","part":"melody"},
{"sha256":"101981fee60fee7e0343373b19b1ae414e54eb8212e6b320e3fb6e1f3a87738f","bytes":1856,"device":"popeye","part":"rom"},
{"sha256":"fb0621194a49a9c565bf883e394c71c8e1ab023a154c87b34af910cf4de5fb8e","bytes":4096,"device":"popeyep","part":"rom"},
{"sha256":"6c46c57f8573bbe1c8beb46e2ae6370fa82cc393a715e1b0da9bc93c250c830e","bytes":256,"device":"popeyep","part":"melody"},
{"sha256":"fb0621194a49a9c565bf883e394c71c8e1ab023a154c87b34af910cf4de5fb8e","bytes":4096,"device":"popeyet","part":"rom"},
{"sha256":"6c46c57f8573bbe1c8beb46e2ae6370fa82cc393a715e1b0da9bc93c250c830e","bytes":256,"device":"popeyet","part":"melody"},
{"sha256":"78bdee56533b5dfa4a031b5c14ae3614e3fa113642c86d1a96e628e1d8990ba5","bytes":4096,"device":"rshower","part":"rom"},
{"sha256":"254d103f04eac2352a2697561e15b60f0e2b8a4b78bcdeae32bd6990a788f3ab","bytes":4096,"device":"sbuster","part":"rom"},
{"sha256":"eac894385cc9523cf1fc5816ba03931e9847c613f0bd693abb61cce26d066135","bytes":256,"device":"sbuster","part":"melody"},
{"sha256":"d4a1eb9d9401edadcb7f903f86918be3000e7afee5ede4b51efa1ea266e38de9","bytes":4096,"device":"smb","part":"rom"},
{"sha256":"05a26b5f9e2ae462a38cb08cc65e39bfaf1e1c992e7f227476ecd92eaa94b115","bytes":256,"device":"smb","part":"melody"},
{"sha256":"d4a1eb9d9401edadcb7f903f86918be3000e7afee5ede4b51efa1ea266e38de9","bytes":4096,"device":"smbn","part":"rom"},
{"sha256":"05a26b5f9e2ae462a38cb08cc65e39bfaf1e1c992e7f227476ecd92eaa94b115","bytes":256,"device":"smbn","part":"melody"},
{"sha256":"d4a1eb9d9401edadcb7f903f86918be3000e7afee5ede4b51efa1ea266e38de9","bytes":4096,"device":"smbspecial","part":"rom"},
{"sha256":"05a26b5f9e2ae462a38cb08cc65e39bfaf1e1c992e7f227476ecd92eaa94b115","bytes":256,"device":"smbspecial","part":"melody"},
{"sha256":"921f7b1683598c928ac486dbdf3741bfa09a28c975aead8fa15375a902699885","bytes":4096,"device":"snoopyp","part":"rom"},
{"sha256":"2c1e9bfc8005494fc281c21dd9dbae92d71355fcb802386c79f48bf711232bab","bytes":256,"device":"snoopyp","part":"melody"},
{"sha256":"921f7b1683598c928ac486dbdf3741bfa09a28c975aead8fa15375a902699885","bytes":4096,"device":"snoopyt","part":"rom"},
{"sha256":"2c1e9bfc8005494fc281c21dd9dbae92d71355fcb802386c79f48bf711232bab","bytes":256,"device":"snoopyt","part":"melody"},
{"sha256":"09148c55a0dc823556f2c98caea9761b5062a7e5614bae4e96b692d8390f9fad","bytes":4096,"device":"squish","part":"rom"},
{"sha256":"d156fde38a4d54e12015aa820cd8363e20455b13f5cc2ab3808c02268107c5a7","bytes":4096,"device":"ssparky","part":"rom"},
{"sha256":"f48929ec8c9a9a1e131f4a5d48333fe2dc2b1fbafcdf41815f267b7c73516247","bytes":4096,"device":"stennis","part":"rom"},
{"sha256":"af4fed4fe0102e17ab18ea005a74026d5c5545f3193eeb195af7daca8df27ee2","bytes":4096,"device":"tbridge","part":"rom"},
{"sha256":"9cb2b6d604d930c94dc8a3d548656b563d487427c957c5c71828b5174385e667","bytes":4096,"device":"tfish","part":"rom"},
{"sha256":"9e1237404bcd8edf0b9d415b928d9ef5d5d475e3fbac65d6678a6dcb3eb47c87","bytes":1856,"device":"vermin","part":"rom"},
{"sha256":"6a53d017f6b18c52472f7cb40a3fb45a9744c1a3c4bb453a162a168705c0f3c1","bytes":4096,"device":"zelda","part":"rom"},
{"sha256":"4dbee2865abcd4767d0c0a1b8a6689efe0c8c49155a9de1ed6ff9abfc43643bc","bytes":256,"device":"zelda","part":"melody"}
];
  var SVG_MANIFEST = [
{"sha256":"db401b6d1774377084bdd12fd7333cb7bcc19854611c7874297aa463b8d4cb30","bytes":72811,"path":"artwork/gnw_ball/gnw_ball.svg"},
{"sha256":"20fa0bb48a7a9cfab813a4c842d1da1e6570dfc47e9041221f379cf23cb0e41d","bytes":589547,"path":"artwork/gnw_bfight/gnw_bfight.svg"},
{"sha256":"c69c97969bafbe2c5b92acda4ba276dc164724a479f130557d495846f9e9128a","bytes":561531,"path":"artwork/gnw_bfightn/gnw_bfightn.svg"},
{"sha256":"027dde7eddb70a6d15c46a762535b7ca5457c67c6fbaf2d93c12bf98086ef170","bytes":114359,"path":"artwork/gnw_bjack/gnw_bjack_bottom.svg"},
{"sha256":"c4c582769bb4b363aee24cd8e884e446d29af45ef5f6fb2ddb6a0268a6242956","bytes":76617,"path":"artwork/gnw_bjack/gnw_bjack_top.svg"},
{"sha256":"1959b5af3a8b37a7f243167edd095b5ec3b7d4f22400d1c8bbe823c6b02531dc","bytes":267045,"path":"artwork/gnw_boxing/gnw_boxing.svg"},
{"sha256":"63c4824cfa5252275cf25f6548637b6cacf215f51b8ade30a897ba3e4c076fe9","bytes":279182,"path":"artwork/gnw_bsweep/gnw_bsweep_bottom.svg"},
{"sha256":"ae12ec5ff7460844b76c49096621c8d79666fc700b43983276c836dfb1ae98ed","bytes":219259,"path":"artwork/gnw_bsweep/gnw_bsweep_top.svg"},
{"sha256":"b117780afee00797cdf42f8dfe125099a699efc059894315d778078e24aaad75","bytes":356585,"path":"artwork/gnw_cgrab/gnw_cgrab.svg"},
{"sha256":"74aa24b59ffd2b59bf81f91a8b94e2f331f99d3cfeebddfece88b17d7b9808a7","bytes":200341,"path":"artwork/gnw_chef/gnw_chef.svg"},
{"sha256":"740452c4b76af3e7430cae7c5ede1b27df0ae53fe3b81f26e2524a2d96d88226","bytes":567878,"path":"artwork/gnw_climber/gnw_climber.svg"},
{"sha256":"389c13b436da2d1b6e9ffc9877decaf76038662e6ffe629f123357709ad7a03f","bytes":545547,"path":"artwork/gnw_climbern/gnw_climbern.svg"},
{"sha256":"0da56c16fe665958c1f1d7cf372050bf3833ecf908a19cf5d757903255888875","bytes":370692,"path":"artwork/gnw_dkcirc/gnw_dkcirc.svg"},
{"sha256":"4f8846901bc76b26ef098f1b9a65a1f9773aa3113ca59a7766bab1f439effe31","bytes":265170,"path":"artwork/gnw_dkhockey/gnw_dkhockey.svg"},
{"sha256":"d1f38e1a77dbacd37dfa5214c1d1e7cff954a6af0adce0e88bc70646904502a9","bytes":282146,"path":"artwork/gnw_dkjr/gnw_dkjr.svg"},
{"sha256":"5ad0b6815a581088d8ebacdc9872017852444c1aeb5435dd84c62398415bd120","bytes":342814,"path":"artwork/gnw_dkjrp/gnw_dkjrp.svg"},
{"sha256":"2fcec16a89557d5ceab65e50ede0b86ec5b1bf0df49b38c4852a93e63a20e42c","bytes":146521,"path":"artwork/gnw_dkong/gnw_dkong_bottom.svg"},
{"sha256":"5f5dbd84a726fb05a1bf46c7c3aa38948cd5e69e7711fe269c4d2aca1539841c","bytes":177776,"path":"artwork/gnw_dkong/gnw_dkong_top.svg"},
{"sha256":"15b40e5486959d1b33952240060bb472afbd53f036df6e8e355760b93584688f","bytes":391531,"path":"artwork/gnw_dkong2/gnw_dkong2_bottom.svg"},
{"sha256":"73734e768c978274c1f70bb440d147d22ff93fc961147444b027b56539835d1e","bytes":268301,"path":"artwork/gnw_dkong2/gnw_dkong2_top.svg"},
{"sha256":"339a166595726460456a0ee1e26e0e49194d9139a4f4679ce94b55fb6f3a8a8c","bytes":294602,"path":"artwork/gnw_dkong3/gnw_dkong3.svg"},
{"sha256":"a6dcd59e0e474b2ea099e42fe4e3ded8c38a333523ef124d1fdc0aefdf3a53c5","bytes":194252,"path":"artwork/gnw_egg/gnw_egg.svg"},
{"sha256":"031e7c5e8e2725f2e16e8ada24fccfbdc49e0ca7926806134f72d9718bc2b6d6","bytes":269534,"path":"artwork/gnw_fireatk/gnw_fireatk.svg"},
{"sha256":"5a351758f7e5015c708a504f531c9540153927df6f0eda4661e8b60dd301c165","bytes":103612,"path":"artwork/gnw_fires/gnw_fires.svg"},
{"sha256":"c48203ca22f8fc8dfbfb7f320700aaa718b295074ad0a0465fb300213bbd06a7","bytes":164998,"path":"artwork/gnw_firews/gnw_fire.svg"},
{"sha256":"a61f10043d00dd8f3a21585793f5a9a2d982aa5e46ce8c3dccb2360948f87e97","bytes":56805,"path":"artwork/gnw_flagman/gnw_flagman.svg"},
{"sha256":"433aba45b2b493c13095d85bff71a0c2cbf27ce03d65d94338f0f8cd4f3bad47","bytes":520873,"path":"artwork/gnw_gcliff/gnw_gcliff_bottom.svg"},
{"sha256":"8ce4562ebdcd5582b8fef692d6a99530509db8ec54528b25ce6ce15432757788","bytes":532129,"path":"artwork/gnw_gcliff/gnw_gcliff_top.svg"},
{"sha256":"e2dcac55bb82463df61fe16b79f77fd4a0f9010f261bcbd6199daf17f55f52f4","bytes":150531,"path":"artwork/gnw_ghouse/gnw_ghouse_bottom.svg"},
{"sha256":"053023ec8dfc4822fcd6d3a0ce79ab324abac04a94fef93ec6ac9e704360416c","bytes":160325,"path":"artwork/gnw_ghouse/gnw_ghouse_top.svg"},
{"sha256":"7fda100a4fa24d2d4c5cdac1a24614ceb3a5f400c8473d9d3a64885e32a3da4e","bytes":110523,"path":"artwork/gnw_helmet/gnw_helmet.svg"},
{"sha256":"4b24fcb7ed2d2dac28d43de40c8c19a59fd302d8b451b85c5c387ba18aad2a1e","bytes":106156,"path":"artwork/gnw_judge/gnw_judge.svg"},
{"sha256":"5917a6516514eb41f4e981d1a6c698f5554e20826428fae7553e23db65eec87e","bytes":157498,"path":"artwork/gnw_lboat/gnw_lboat_left.svg"},
{"sha256":"c46292b8a7ca6b1c494a0ad49872e2068d591d7642026f2bed4e52a6f1377a93","bytes":156142,"path":"artwork/gnw_lboat/gnw_lboat_right.svg"},
{"sha256":"3287f0bf3dac82ce57faba1b53add1b41bdc98bc5cdaeff43779a78774b7f579","bytes":156926,"path":"artwork/gnw_lion/gnw_lion.svg"},
{"sha256":"a58b313a80e816f9c0525fb09d2c109bb5288c761b83039bfd074506cc308da8","bytes":126666,"path":"artwork/gnw_manhole/gnw_manhole.svg"},
{"sha256":"f2f2035d1a60a35d875ee882f2cad9d070ae845fca1d83af7c31a6a49117d201","bytes":225172,"path":"artwork/gnw_manholews/gnw_manholews.svg"},
{"sha256":"2f61efc7797dcd87e43ebc36a2868f76ac109f09b5712e1c1d6f405312158758","bytes":156294,"path":"artwork/gnw_mario/gnw_mario_left.svg"},
{"sha256":"7acdb7e3da77205ff9127925fe3224fdac041b88f9a5d3e249a7b4e645ff774c","bytes":204213,"path":"artwork/gnw_mario/gnw_mario_right.svg"},
{"sha256":"3e0c5dbdc0750c1efcbffa3d1f5b51f2f75a71b267a730cc06c5b1047d8fe6f2","bytes":304752,"path":"artwork/gnw_mariocm/gnw_mariocm.svg"},
{"sha256":"9f7cdafba96d23ca8665cb0416d0978884ac34a09b4c926a0dd990df1cef2247","bytes":295811,"path":"artwork/gnw_mariocmt/gnw_mariocmt.svg"},
{"sha256":"b8858d8a499d42e084164ea78698db5ac96f977845f9255788292af52497e642","bytes":212480,"path":"artwork/gnw_mariotj/gnw_mariotj.svg"},
{"sha256":"5d7e4e226121745c44ba513d95ad813589925737330bf244f26ea57d6a2074dd","bytes":519301,"path":"artwork/gnw_mbaway/gnw_mbaway.svg"},
{"sha256":"46df4f33ed7ed42a48c95f284c94900ef082bda81d80e54ee408dd2e1cafc98e","bytes":123462,"path":"artwork/gnw_mickdon/gnw_mickdon_bottom.svg"},
{"sha256":"2d608b7fa9e689434ee5c4d2c512db07681f86689e7c92dd7004b187d6362d46","bytes":127097,"path":"artwork/gnw_mickdon/gnw_mickdon_top.svg"},
{"sha256":"bb5b2a2bffcd4c60716010951a6569bab20361c33d355ef5a1d5ef83b9ff852e","bytes":182853,"path":"artwork/gnw_mmouse/gnw_mmouse.svg"},
{"sha256":"dd8047bc490098c9f45f881d5396c61875196b100d23274505e4a48ca18da7dc","bytes":278396,"path":"artwork/gnw_mmousep/gnw_mmousep.svg"},
{"sha256":"f4cc48381f04c1d1ae518a3ed048d9e51d71e15d877d709cd34aead414a65bc4","bytes":120914,"path":"artwork/gnw_octopus/gnw_octopus.svg"},
{"sha256":"2a1d45109930b9fa728a944ec107342c56d184e9cc28260c5f0b30194edfe70a","bytes":113943,"path":"artwork/gnw_opanic/gnw_opanic_bottom.svg"},
{"sha256":"e51ca763ed4dcf30034f1f63756e595ce17a10bf0f801cdf929e04fc2e0a294a","bytes":80532,"path":"artwork/gnw_opanic/gnw_opanic_top.svg"},
{"sha256":"17fc8deafbc5206aa524ddbdc19b74dc521ff05fd735a6c854f7a62a85b44820","bytes":170880,"path":"artwork/gnw_pchute/gnw_pchute.svg"},
{"sha256":"43599af8dee6e6ad633b0d4468f8180d453d40995938a8707641d576f78f88f0","bytes":64411,"path":"artwork/gnw_pinball/gnw_pinball_bottom.svg"},
{"sha256":"435558e1dafecd8a335b914e3ab03dd201c9d6441592431004ac34380f55bfb6","bytes":84347,"path":"artwork/gnw_pinball/gnw_pinball_top.svg"},
{"sha256":"360ad99fdcbd6cea85104d2f4f4bc2dcbdaa60d6ce541a7bd504209b37c68f82","bytes":219719,"path":"artwork/gnw_popeye/gnw_popeye.svg"},
{"sha256":"c2d10045b8fdbb1c5d312bf67708b398de7b5d18fd78d974d7d08dc280e8027d","bytes":546685,"path":"artwork/gnw_popeyep/gnw_popeyep.svg"},
{"sha256":"d3264386857e93ce3f9b025e2d87747a703b5eac5faeb336daeccb1965e7294a","bytes":136866,"path":"artwork/gnw_rshower/gnw_rshower_left.svg"},
{"sha256":"e3e1584adbbab4af82ce91ac98ef06fe3e6d84b9b0b92c1263615933a634bc85","bytes":141743,"path":"artwork/gnw_rshower/gnw_rshower_right.svg"},
{"sha256":"9e8c7796433be7051cd3e52f6e2cf72680973bf4b0d402a8078d802a79c4902a","bytes":284193,"path":"artwork/gnw_sbuster/gnw_sbuster_bottom.svg"},
{"sha256":"621be5b7056202a614e215095b34ada3f360f28ad52155b2281f286127e55d9d","bytes":223262,"path":"artwork/gnw_sbuster/gnw_sbuster_top.svg"},
{"sha256":"206326c8a52dddc3f70f9c7c3c85032300036a41621e5a24cbc0722b5966257c","bytes":344665,"path":"artwork/gnw_smb/gnw_smb.svg"},
{"sha256":"7482849ce4280f08b566eb8a4f401336ac7619350d7c8c3e8f1c79d6d012fa16","bytes":651572,"path":"artwork/gnw_smbn/gnw_smbn.svg"},
{"sha256":"2b5eeb4830537fd75615b3ff7dd831228a4d80f19175d68bc249874820cddd4b","bytes":356635,"path":"artwork/gnw_snoopyp/gnw_snoopyp.svg"},
{"sha256":"f1b1078d9efcbdcdccde7e73b3488d0200714c7cd58160dd39bca471cd9c2591","bytes":281182,"path":"artwork/gnw_squish/gnw_squish_bottom.svg"},
{"sha256":"b50d5b118f4342df6fe51889bfcd8fac9d037c87357a778f89c2268b4a6c89df","bytes":73162,"path":"artwork/gnw_squish/gnw_squish_top.svg"},
{"sha256":"803f97224dd9bff1fca47fc6af484a6dac1970abdbc0f9180cdda2471b9ed219","bytes":138996,"path":"artwork/gnw_ssparky/gnw_ssparky.svg"},
{"sha256":"c12a157a26093e69ed323d9490aa4c489eea40e66157156c29191713cf5531ee","bytes":230033,"path":"artwork/gnw_stennis/gnw_stennis.svg"},
{"sha256":"48d387dfb0a2c7720e2ca0408ac79386c8efd9b90a89fbfd61c48a39e7e35865","bytes":244842,"path":"artwork/gnw_tbridge/gnw_tbridge.svg"},
{"sha256":"038da030e3d0874b83d6ee25ef43bdf42ccac4a4b15a6cefa104aa4ecf1b92c5","bytes":259233,"path":"artwork/gnw_tfish/gnw_tfish.svg"},
{"sha256":"32f3f2709b4db5f35c43e549edb60217c322dac795c2aa43fdd05cb9dc046779","bytes":106730,"path":"artwork/gnw_vermin/gnw_vermin.svg"},
{"sha256":"af77426838046e7d94484b6cca75cc456f8e4ae8707dc204c1c1f70716c85131","bytes":426909,"path":"artwork/gnw_zelda/gnw_zelda_bottom.svg"},
{"sha256":"ab346f76a6f706f4bb5a8d95eb5fcd84c4ef9f99dfc3a35a1c1a5e09524cd1c9","bytes":284070,"path":"artwork/gnw_zelda/gnw_zelda_top.svg"}
];
  var TFT = { internal: 131072, mario: 1048576, zelda: 4194304 };
  // Pokemon mini: 10 game ROMs (512 KB each) + one shared 4 KB BIOS ('bios'),
  // matched by whole-file SHA-256 exactly like the classic ROMs.
  var PM_MANIFEST = [
{"sha256":"16b3a68bb9d3e5c577bc6cf6d9d73c39b4c40b76ca3fbf1a0b9288089f97a014","bytes":524288,"device":"pm-pichu-bros-mini"},
{"sha256":"7914ae74c227dd29c93fc9ee23f16da4489396cfa160d034c2394f4bcd3d06e3","bytes":524288,"device":"pm-pokemon-breeder-mini"},
{"sha256":"9c6619a683f76dcb63957d02ac4e812f9148b85e05cc6705b24a8a4e6080b221","bytes":524288,"device":"pm-pokemon-party-mini"},
{"sha256":"5ac75fd2b6d5dea85e17e5e6131339e0e19eefe978a6f4b7f8700fb28c89cc23","bytes":524288,"device":"pm-pokemon-pinball-mini"},
{"sha256":"6c473867e9bad1883307d5372dedfa9443a620423d82ae83b6171fcaaffc291e","bytes":524288,"device":"pm-pokemon-puzzle-collection"},
{"sha256":"e303afb55f858b284029abe69a7f96d58bf46956cd3e12cc3c1134e171ffae25","bytes":524288,"device":"pm-pokemon-puzzle-collection-vol-2"},
{"sha256":"bc5d1c0664d0f80900558f1e99dded5fe597535b468aefc13c1dae51c18b4fbb","bytes":524288,"device":"pm-pokemon-race-mini"},
{"sha256":"b54fc57472d363111eb0b229b5e26d3eb653c1b85f211501beab640530d19805","bytes":524288,"device":"pm-pokemon-shock-tetris"},
{"sha256":"dc96d606ed54be035e8c3139a0b20d462b7622b15f617ccc6be411dcbd68c921","bytes":524288,"device":"pm-pokemon-zany-cards"},
{"sha256":"19265776c8aa438a20a18064fa4097c33ba8edf9d4b712c73e3fd431bd724187","bytes":524288,"device":"pm-togepis-great-adventure"},
{"sha256":"45a1c7f28b9ad585e67f047abe9c1c956724bfcab8c9011002af4274e7c50e8f","bytes":4096,"device":"bios"}
  ];
  var PM_ROM = 524288, PM_BIOS = 4096;
  var MAX_ROM = 262144;      // ROM candidates: this size or smaller (matches builder)
  var MAX_SVG = 2097152;     // SVG candidates: this size or smaller

  var _dec = new TextDecoder();
  function utf8(u8) { return _dec.decode(u8); }

  // --- SHA-256 → lowercase hex ------------------------------------------------
  function sha256hex(u8) {
    return crypto.subtle.digest('SHA-256', u8).then(function (buf) {
      var a = new Uint8Array(buf), s = '';
      for (var i = 0; i < a.length; i++) s += (a[i] >>> 4).toString(16) + (a[i] & 15).toString(16);
      return s;
    });
  }

  // --- Uint8Array → base64 (chunked, matches the builder's b64 output) --------
  function b64(u8) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }

  // --- raw DEFLATE inflate via the browser's own DecompressionStream ----------
  function inflateRaw(u8) {
    var ds = new DecompressionStream('deflate-raw');
    var w = ds.writable.getWriter();
    w.write(u8); w.close();
    return new Response(ds.readable).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  // --- minimal .zip reader: central directory + stored/deflate entries --------
  // Recurses into nested .zip entries, namespacing inner names under the outer
  // archive's name so per-unit TFT files never collide (…/HXA-001.zip/… etc).
  // .7z/.rar can't be read in-browser (no library) — those are simply skipped.
  function readZip(buf) {
    var dv = new DataView(buf), u8 = new Uint8Array(buf), n = buf.byteLength;
    if (n < 22) return Promise.reject(new Error('File too small to be a .zip.'));
    var eocd = -1, min = Math.max(0, n - 22 - 65535);
    for (var i = n - 22; i >= min; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) return Promise.reject(new Error('Not a valid .zip (no end-of-central-directory record).'));
    var count = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true);
    var meta = [], p = cdOff;
    for (var k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true);
      var comp = dv.getUint32(p + 20, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var commLen = dv.getUint16(p + 32, true);
      var lho = dv.getUint32(p + 42, true);
      var name = utf8(u8.subarray(p + 46, p + 46 + nameLen));
      meta.push({ name: name, method: method, comp: comp, lho: lho });
      p += 46 + nameLen + extraLen + commLen;
    }
    var out = [], chain = Promise.resolve();
    meta.forEach(function (e) {
      if (!e.name || e.name.charAt(e.name.length - 1) === '/') return;   // directory entry
      chain = chain.then(function () {
        var lp = e.lho;
        if (dv.getUint32(lp, true) !== 0x04034b50) return;               // bad/again-central; skip
        var lNameLen = dv.getUint16(lp + 26, true), lExtraLen = dv.getUint16(lp + 28, true);
        var start = lp + 30 + lNameLen + lExtraLen;
        var body = u8.subarray(start, start + e.comp);
        var data = (e.method === 0) ? Promise.resolve(body.slice())
                 : (e.method === 8) ? inflateRaw(body)
                 : null;
        if (!data) return;                                               // unsupported compression
        return data.then(function (bytes) {
          if (/\.zip$/i.test(e.name) && bytes.byteLength > 22) {         // nested archive
            var ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            return readZip(ab).then(function (inner) {
              inner.forEach(function (x) { out.push({ name: e.name + '/' + x.name, bytes: x.bytes }); });
            }).catch(function () { /* skip an unreadable nested zip */ });
          }
          out.push({ name: e.name, bytes: bytes });
        });
      });
    });
    return chain.then(function () { return out; });
  }

  // --- identify entries → { roms, art, tft } (mirrors the builder's Consider) -
  function identify(entries) {
    var romByHash = {}, svgByHash = {}, pmByHash = {};
    ROM_MANIFEST.forEach(function (r) { (romByHash[r.sha256] = romByHash[r.sha256] || []).push(r); });
    SVG_MANIFEST.forEach(function (s) { svgByHash[s.sha256] = s.path; });
    PM_MANIFEST.forEach(function (p) { pmByHash[p.sha256] = p.device; });
    var knownLens = ROM_MANIFEST.map(function (r) { return r.bytes; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; })
      .sort(function (a, b) { return b - a; });

    var roms = {}, art = {}, groups = {}, pmini = {};   // groups[dir] = { internal, mario, zelda }
    var chain = Promise.resolve();
    entries.forEach(function (e) {
      var len = e.bytes.length;
      chain = chain.then(function () {
        if (len === TFT.internal || len === TFT.mario || len === TFT.zelda) {
          var dir = e.name.replace(/[^/]*$/, '');       // parent path = pairing container
          var g = groups[dir] || (groups[dir] = {});
          if (len === TFT.internal) { if (!g.internal) g.internal = e.bytes; }
          else if (len === TFT.mario) { if (!g.mario) g.mario = e.bytes; }
          else if (!g.zelda) { g.zelda = e.bytes; }
          return;
        }
        // Pokemon mini ROM/BIOS (whole-file hash). A matched 512 KB or 4 KB file
        // is stored here; an unmatched 512 KB file is not a ROM/SVG candidate, so
        // it stops. An unmatched 4 KB file falls through to the classic paths.
        var pmCheck = (len === PM_ROM || len === PM_BIOS)
          ? sha256hex(e.bytes).then(function (h) {
              if (pmByHash[h]) { if (!pmini[pmByHash[h]]) pmini[pmByHash[h]] = b64(e.bytes); return true; }
              return false;
            })
          : Promise.resolve(false);
        return pmCheck.then(function (pmMatched) {
          if (pmMatched || len === PM_ROM) return;
          return identifyRomOrSvg(e, len);
        });
      });
    });

    // classic ROM (with truncation fallback) then SVG whole-file hash
    function identifyRomOrSvg(e, len) {
        if (len === 0 || len > MAX_SVG) return;
        var tryLens = [len];                            // ROM: try real length, then smaller known
        if (len <= MAX_ROM) for (var j = 0; j < knownLens.length; j++) if (knownLens[j] < len) tryLens.push(knownLens[j]);
        return (function tryRom(i) {
          if (i >= tryLens.length || len > MAX_ROM) return Promise.resolve(false);
          var tl = tryLens[i];
          return sha256hex(e.bytes.subarray(0, tl)).then(function (h) {
            if (romByHash[h]) {
              romByHash[h].forEach(function (row) {
                var d = roms[row.device] || (roms[row.device] = {});
                if (!d[row.part]) d[row.part] = b64(e.bytes.subarray(0, tl));
              });
              return true;
            }
            return tryRom(i + 1);
          });
        })(0).then(function (matched) {
          if (matched) return;
          return sha256hex(e.bytes).then(function (h) {  // SVG: whole-file hash
            if (svgByHash[h] && !art[svgByHash[h]]) art[svgByHash[h]] = utf8(e.bytes);
          });
        });
    }

    return chain.then(function () {
      var tft = {};
      Object.keys(groups).forEach(function (dir) {
        var g = groups[dir];
        if (!g.internal) return;
        if (g.mario && !tft.mario) tft.mario = { internal: b64(g.internal), external: b64(g.mario) };
        else if (g.zelda && !tft.zelda) tft.zelda = { internal: b64(g.internal), external: b64(g.zelda) };
      });
      return { roms: roms, art: art, tft: tft, pokemini: pmini };
    });
  }

  // --- what a pack covers, for the Settings summary ---------------------------
  function summarize(pack) {
    var romDevices = {}; ROM_MANIFEST.forEach(function (r) { if (r.part === 'rom') romDevices[r.device] = 1; });
    var allRom = Object.keys(romDevices);
    var haveRom = allRom.filter(function (d) { return pack.roms[d] && pack.roms[d].rom; });
    var allArt = SVG_MANIFEST.map(function (s) { return s.path; });
    var haveArt = allArt.filter(function (p) { return pack.art[p]; });
    var haveTft = Object.keys(pack.tft || {});
    var pm = pack.pokemini || {};
    var allPm = PM_MANIFEST.filter(function (p) { return p.device !== 'bios'; }).map(function (p) { return p.device; });
    var havePm = allPm.filter(function (d) { return pm[d]; });
    var pmBios = !!pm.bios;
    return {
      roms: { found: haveRom.length, total: allRom.length, missing: allRom.filter(function (d) { return haveRom.indexOf(d) < 0; }) },
      art: { found: haveArt.length, total: allArt.length },
      tft: { found: haveTft.length, total: 2, units: haveTft },
      pokemini: { found: havePm.length, total: allPm.length, bios: pmBios, missing: allPm.filter(function (d) { return havePm.indexOf(d) < 0; }) },
      empty: haveRom.length === 0 && haveArt.length === 0 && haveTft.length === 0 && havePm.length === 0 && !pmBios
    };
  }

  // --- IndexedDB (single record holding the assembled pack) -------------------
  var DB = 'gnwContentPack', STORE = 'pack', KEY = 'current';
  function openDb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbGet() { return openDb().then(function (db) { return new Promise(function (res, rej) { var q = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { rej(q.error); }; }); }); }
  function idbPut(v) { return openDb().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(v, KEY); t.oncomplete = function () { res(); }; t.onerror = function () { rej(t.error); }; }); }); }
  function idbDel() { return openDb().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(KEY); t.oncomplete = function () { res(); }; t.onerror = function () { rej(t.error); }; }); }); }

  // --- feed the colour-unit firmware to the MAIN-THREAD twin (tiles / drawer);
  //     the play-window worker asks for it separately (see twin-worker.js). -----
  var _pack = null;
  function applyToPage(pack) {
    if (!pack || !pack.tft) return;
    window.__ARM_FW = window.__ARM_FW || {};
    for (var u in pack.tft) if (!window.__ARM_FW[u]) window.__ARM_FW[u] = pack.tft[u];
  }

  // Load any stored pack up front; gnw.js awaits this before falling back to it.
  var ready = idbGet().then(function (p) { _pack = p; applyToPage(p); return p; })
    .catch(function () { _pack = null; return null; });

  window.__GNW_PACK = {
    ready: ready,
    has: function () { return !!_pack; },
    roms: function () { return _pack && _pack.roms; },
    art: function () { return _pack && _pack.art; },
    tft: function (u) { return _pack && _pack.tft && _pack.tft[u]; },
    // Pokemon mini: whole map ({id:b64, bios:b64}) or one id's base64. The main
    // frontend lazy-loads firmware/pokemini_roms.json first; this is the fallback.
    pokemini: function (id) { var pm = _pack && _pack.pokemini; if (!pm) return null; return id ? pm[id] : pm; },
    summary: function () { return _pack ? summarize(_pack) : null; },
    // Import a user-picked .zip: parse → identify → persist → apply. Resolves
    // with the summary; rejects if the file isn't a readable zip.
    importZip: function (file) {
      return file.arrayBuffer().then(readZip).then(identify).then(function (pack) {
        return idbPut(pack).then(function () { _pack = pack; applyToPage(pack); return summarize(pack); });
      });
    },
    clear: function () { return idbDel().then(function () { _pack = null; }); }
  };
})();
