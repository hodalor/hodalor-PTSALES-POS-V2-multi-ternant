import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../data/models.dart';
import '../theme/app_colors.dart';

class SparklineChart extends StatelessWidget {
  const SparklineChart({super.key, required this.values, this.color = Colors.white});

  final List<double> values;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _SparklinePainter(values, color),
      size: Size.infinite,
    );
  }
}

class _SparklinePainter extends CustomPainter {
  _SparklinePainter(this.values, this.color);
  final List<double> values;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    if (values.length < 2) return;
    final minV = values.reduce(math.min);
    final maxV = values.reduce(math.max);
    final span = (maxV - minV).clamp(1, double.infinity);
    final path = Path();
    for (var i = 0; i < values.length; i++) {
      final x = size.width * i / (values.length - 1);
      final y = size.height - ((values[i] - minV) / span) * size.height;
      if (i == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    final paint = Paint()
      ..color = color
      ..strokeWidth = 2.4
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant _SparklinePainter oldDelegate) =>
      oldDelegate.values != values || oldDelegate.color != color;
}

class SalesBarChart extends StatelessWidget {
  const SalesBarChart({super.key, required this.points});

  final List<TrendPoint> points;

  @override
  Widget build(BuildContext context) {
    if (points.isEmpty) {
      return const SizedBox(
        height: 92,
        child: Center(child: Text('No sales in this period', style: TextStyle(color: AppColors.muted))),
      );
    }
    final maxV = points.map((p) => p.value).fold<double>(0, (s, v) => v > s ? v : s);
    final safeMax = maxV <= 0 ? 1.0 : maxV;
    return Column(
      children: [
        SizedBox(
          height: 92,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              for (var i = 0; i < points.length; i++) ...[
                if (i > 0) const SizedBox(width: 10),
                Expanded(
                  child: Align(
                    alignment: Alignment.bottomCenter,
                    child: Container(
                      height: 24 + (points[i].value / safeMax) * 68,
                      decoration: BoxDecoration(
                        color: i == points.length - 1 ? AppColors.primary : const Color(0xFFBFDBFE),
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            for (final p in points)
              Expanded(
                child: Text(
                  p.label,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: AppColors.muted,
                  ),
                ),
              ),
          ],
        ),
      ],
    );
  }
}

class SalesLineChart extends StatelessWidget {
  const SalesLineChart({super.key, required this.points, this.highlightLabel = '₵32,820'});

  final List<TrendPoint> points;
  final String highlightLabel;

  @override
  Widget build(BuildContext context) {
    if (points.isEmpty) {
      return const SizedBox(
        height: 160,
        child: Center(child: Text('No sales in this period', style: TextStyle(color: AppColors.muted))),
      );
    }
    final maxV = points.map((p) => p.value).fold<double>(0, (s, v) => v > s ? v : s);
    final maxY = maxV <= 0 ? 1.0 : maxV * 1.15;
    String tick(double fraction) => _axisLabel(maxY * fraction);
    return SizedBox(
      height: 196,
      child: Column(
        children: [
          Expanded(
            child: Row(
              children: [
                SizedBox(
                  width: 36,
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      _AxisLabel(tick(1)),
                      _AxisLabel(tick(0.75)),
                      _AxisLabel(tick(0.5)),
                      _AxisLabel(tick(0.25)),
                      const _AxisLabel('0'),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: ClipRect(
                    child: CustomPaint(
                      painter: _LineChartPainter(points, maxY),
                      child: Stack(
                        clipBehavior: Clip.hardEdge,
                        children: [
                          Positioned(
                            right: 0,
                            top: 4,
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: AppColors.primary,
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Text(
                                highlightLabel,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              const SizedBox(width: 36),
              for (final p in points)
                Expanded(
                  child: Text(
                    p.label,
                    textAlign: TextAlign.center,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: AppColors.muted,
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

String _axisLabel(double value) {
  if (value >= 1000000) return '${(value / 1000000).toStringAsFixed(1)}M';
  if (value >= 1000) return '${(value / 1000).toStringAsFixed(value >= 10000 ? 0 : 1)}K';
  return value.toStringAsFixed(0);
}

class _AxisLabel extends StatelessWidget {
  const _AxisLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(fontSize: 10, color: AppColors.muted, fontWeight: FontWeight.w600),
    );
  }
}

class _LineChartPainter extends CustomPainter {
  _LineChartPainter(this.points, this.maxY);
  final List<TrendPoint> points;
  final double maxY;

  @override
  void paint(Canvas canvas, Size size) {
    if (points.length < 2 || size.width <= 0 || size.height <= 0) return;
    Offset pt(int i) {
      final x = size.width * i / (points.length - 1);
      final ratio = (points[i].value / maxY).clamp(0.0, 1.0);
      final y = size.height - ratio * size.height;
      return Offset(x, y);
    }

    final grid = Paint()
      ..color = const Color(0xFFE2E8F0)
      ..strokeWidth = 1;
    for (var i = 0; i < 5; i++) {
      final y = size.height * i / 4;
      canvas.drawLine(Offset(0, y), Offset(size.width, y), grid);
    }

    final fillPath = Path()..moveTo(0, size.height);
    final linePath = Path();
    for (var i = 0; i < points.length; i++) {
      final p = pt(i);
      if (i == 0) {
        linePath.moveTo(p.dx, p.dy);
        fillPath.lineTo(p.dx, p.dy);
      } else {
        final prev = pt(i - 1);
        final cpx = (prev.dx + p.dx) / 2;
        linePath.cubicTo(cpx, prev.dy, cpx, p.dy, p.dx, p.dy);
        fillPath.cubicTo(cpx, prev.dy, cpx, p.dy, p.dx, p.dy);
      }
    }
    fillPath
      ..lineTo(size.width, size.height)
      ..close();

    final fill = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [Color(0x552563EB), Color(0x00DBEAFE)],
      ).createShader(Offset.zero & size);
    canvas.drawPath(fillPath, fill);

    final line = Paint()
      ..color = AppColors.primary
      ..strokeWidth = 2.6
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    canvas.drawPath(linePath, line);

    final last = pt(points.length - 1);
    canvas.drawCircle(last, 7, Paint()..color = Colors.white);
    canvas.drawCircle(last, 5, Paint()..color = AppColors.primary);
  }

  @override
  bool shouldRepaint(covariant _LineChartPainter oldDelegate) =>
      oldDelegate.points != points || oldDelegate.maxY != maxY;
}

class DonutChart extends StatelessWidget {
  const DonutChart({super.key, required this.slices, required this.centerValue, required this.centerLabel});

  final List<CategoryShare> slices;
  final String centerValue;
  final String centerLabel;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 132,
      height: 132,
      child: CustomPaint(
        painter: _DonutPainter(slices),
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                centerValue,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  color: AppColors.text,
                  height: 1.1,
                ),
              ),
              Text(
                centerLabel,
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: AppColors.muted,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DonutPainter extends CustomPainter {
  _DonutPainter(this.slices);
  final List<CategoryShare> slices;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Rect.fromCircle(center: size.center(Offset.zero), radius: size.width / 2);
    const gap = 0.04;
    var start = -math.pi / 2;
    final total = slices.fold<int>(0, (s, e) => s + e.percent);
    if (total <= 0) return;
    for (final slice in slices) {
      final sweep = (slice.percent / total) * (math.pi * 2 - gap * slices.length);
      final paint = Paint()
        ..color = slice.color
        ..style = PaintingStyle.stroke
        ..strokeWidth = 18
        ..strokeCap = StrokeCap.butt;
      canvas.drawArc(rect.deflate(9), start, sweep, false, paint);
      start += sweep + gap;
    }
  }

  @override
  bool shouldRepaint(covariant _DonutPainter oldDelegate) => oldDelegate.slices != slices;
}

class ProgressBar extends StatelessWidget {
  const ProgressBar({super.key, required this.value, required this.color});

  final double value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(99),
      child: LayoutBuilder(
        builder: (context, constraints) {
          return Stack(
            children: [
              Container(height: 8, color: const Color(0xFFF1F5F9)),
              Container(
                height: 8,
                width: constraints.maxWidth * value.clamp(0, 1),
                color: color,
              ),
            ],
          );
        },
      ),
    );
  }
}
