package cz.audibudiky

import kotlin.math.abs

/**
 * Conversion of KW1281 measuring values (type, a, b) to physical values.
 * Formulas follow the commonly published VAG KW1281 tables. Types not listed
 * are returned raw so they can still be compared with VCDS-Lite.
 */
object Formulas {
    fun decode(t: Int, a: Int, b: Int): Field {
        fun f(v: Double, u: String) = Field(t, a, b, v, u, "")
        return when (t) {
            1 -> f(0.2 * a * b, "ot/min")
            2 -> f(a * 0.002 * b, "%")
            3 -> f(0.002 * a * b, "°")
            4 -> f(abs(b - 127) * 0.01 * a, if (b > 127) "° po HÚ" else "° před HÚ")
            5 -> f(a * (b - 100) * 0.1, "°C")
            6 -> f(0.001 * a * b, "V")
            7 -> f(0.01 * a * b, "km/h")
            8 -> f(0.1 * a * b, "")
            9 -> f((b - 127) * 0.02 * a, "°")
            10 -> Field(t, a, b, null, "", if (b == 0) "studený" else "teplý")
            11 -> f(0.0001 * a * (b - 128) + 1, "")
            12 -> f(0.001 * a * b, "Ω")
            13 -> f((b - 127) * 0.001 * a, "mm")
            14 -> f(0.005 * a * b, "bar")
            15 -> f(0.01 * a * b, "ms")
            18 -> f(0.04 * a * b, "mbar")
            19 -> f(a * b * 0.01, "l")
            20 -> f(a * (b - 128) / 128.0, "%")
            21 -> f(0.001 * a * b, "V")
            22 -> f(0.001 * a * b, "ms")
            23 -> f(b / 256.0 * a, "%")
            24 -> f(0.001 * a * b, "A")
            25 -> f(b * 1.421 + a / 182.0, "g/s")
            26 -> f((b - a).toDouble(), "°C")
            27 -> f(abs(b - 128) * 0.01 * a, "°")
            28 -> f((b - a).toDouble(), "")
            31 -> f(b / 2560.0 * a, "°C")
            33 -> f(if (a == 0) 0.0 else 100.0 * b / a, "%")
            34 -> f((b - 128) * 0.01 * a, "kW")
            35 -> f(0.01 * a * b, "l/h")
            36 -> f(a * 2560.0 + b * 10, "km")
            38 -> f((b - 128) * 0.001 * a, "°KW")
            39 -> f(b / 256.0 * a, "mg/zdvih")
            40 -> f(b * 0.1 + 25.5 * a - 400, "A")
            41 -> f(b + a * 255.0, "Ah")
            42 -> f(b * 0.1 + 25.5 * a - 400, "kW")
            43 -> f(b * 0.1 + 25.5 * a, "V")
            45 -> f(0.1 * a * b / 100, "")
            47 -> f(((b - 128) * a).toDouble(), "ms")
            48 -> f(b + a * 255.0, "")
            49 -> f(b / 4.0 * a * 0.1, "mg/zdvih")
            50 -> f(if (a == 0) 0.0 else (b - 128) / (0.01 * a), "mbar")
            51 -> f((b - 128) / 255.0 * a, "mg/zdvih")
            52 -> f(b * 0.02 * a - a, "Nm")
            53 -> f((b - 128) * 1.4222 + 0.006 * a, "g/s")
            54 -> f(a * 256.0 + b, "")
            55 -> f(a * b / 200.0, "s")
            else -> Field(t, a, b, null, "", "typ $t")
        }
    }
}
