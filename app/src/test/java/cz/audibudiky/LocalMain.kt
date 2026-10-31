package cz.audibudiky

/** Local runner (outside Gradle): prints every scenario result. */
fun main() {
    var fails = 0
    for ((name, run) in KwScenarios.ALL) {
        val t0 = System.currentTimeMillis()
        try { println("✓ $name — ${run()}  [${System.currentTimeMillis() - t0} ms]") }
        catch (e: Throwable) { fails++; println("✗ $name — ${e.javaClass.simpleName}: ${e.message}") }
    }
    println(if (fails == 0) "VŠE OK" else "SELHALO: $fails")
}
