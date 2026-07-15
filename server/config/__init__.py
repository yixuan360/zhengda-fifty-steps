# PyMySQL monkey-patch：替代 mysqlclient，必须在 Django 加载前执行
import pymysql
pymysql.install_as_MySQLdb()
