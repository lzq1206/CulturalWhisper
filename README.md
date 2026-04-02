# CulturalWhisper

全国重点文物保护单位地图展示页。

## 功能

- 自动加载 `./data/CulRelPro_China_1961-2019.kml`
- 支持拖拽导入 KML / GeoJSON
- 支持搜索、批次筛选、省份筛选、类型筛选
- 地图点位点击后查看详情
- 自动统计点位、批次、省份和筛选结果

## 本地运行

用任意静态服务器打开即可，例如：

```bash
python3 -m http.server 8080
```

然后访问 `http://127.0.0.1:8080/CulturalWhisper/`

## 数据位置

把数据文件放到：

```text
CulturalWhisper/data/CulRelPro_China_1961-2019.kml
```

如果没有 KML，也可以拖拽文件到页面导入。
